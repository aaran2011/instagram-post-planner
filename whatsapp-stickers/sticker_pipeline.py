#!/usr/bin/env python3
"""
WhatsApp sticker batch pipeline.

Takes a folder, a ZIP, or a public Google Drive folder link full of images
(sticker-pack screenshots, contact sheets, single stickers), and produces a
ZIP of 512x512 transparent PNG (+ WebP) stickers with a full report.

    python3 sticker_pipeline.py INPUT [-o OUTPUT_DIR] [options]

INPUT may be:  a folder (searched recursively), a .zip file, a single image,
or a "https://drive.google.com/drive/folders/..." link shared as
"Anyone with the link".

Stages
  1. collect   - gather images, copy originals (inputs are never modified)
  2. detect    - find contact sheets / grids and split them into tiles;
                 single images are left whole; ambiguous layouts are flagged
  3. upscale   - Real-ESRGAN (AI, local, GPU) for anything below sticker size,
                 Lanczos + unsharp fallback if the AI upscaler isn't installed
  4. matte     - remove the flat tile/card background (colour-key flood fill
                 from the edges, soft anti-aliased edges, colour
                 decontamination); keeps existing transparency; optional AI
                 cut-out (rembg) for full-frame photos
  5. export    - tight crop, fit inside 512x512 with a margin, centre,
                 PNG + WhatsApp WebP (<100 KB); duplicates set aside
  6. report    - report.html / report.csv / report.json / summary.txt, ZIP
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import hashlib
import html
import io
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

try:
    from tqdm import tqdm
except ImportError:  # progress bars are nice-to-have
    def tqdm(it=None, **kw):
        return it if it is not None else _NullBar()

    class _NullBar:
        def update(self, n=1): pass
        def close(self): pass
        def set_postfix_str(self, s): pass

try:  # optional HEIC/HEIF support
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_OK = True
except Exception:
    HEIF_OK = False

Image.MAX_IMAGE_PIXELS = 200_000_000  # big contact sheets are fine, bombs are not

HERE = Path(__file__).resolve().parent
TOOLS = HERE / "tools"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic", ".heif"}
STICKER = 512

log = logging.getLogger("stickers")


# --------------------------------------------------------------------------
# 1. Collect inputs
# --------------------------------------------------------------------------

def fetch_drive_folder(url: str, dest: Path, depth: int = 0) -> list[Path]:
    """Download every file in a public ("Anyone with the link") Drive folder.

    Uses Drive's public embedded folder view, so no Google login or API key is
    needed. Subfolders are followed up to 3 levels deep.
    """
    m = re.search(r"folders/([\w-]+)", url) or re.search(r"[?&]id=([\w-]+)", url)
    if not m:
        raise ValueError(f"Not a Google Drive folder link: {url}")
    folder_id = m.group(1)
    dest.mkdir(parents=True, exist_ok=True)
    page = _http_get(f"https://drive.google.com/embeddedfolderview?id={folder_id}").decode("utf-8", "replace")
    files = re.findall(r'file/d/([\w-]+)/view[^>]*>.*?flip-entry-title">([^<]+)', page, re.S)
    folders = re.findall(r'folders/([\w-]+)"[^>]*>.*?flip-entry-title">([^<]+)', page, re.S)
    if not files and not folders and depth == 0:
        raise RuntimeError("Drive folder looks empty or private. Share it as 'Anyone with the link', "
                           "or download it as a ZIP and pass the ZIP instead.")
    out = []
    for fid, name in tqdm(files, desc=f"Downloading from Drive{' (subfolder)' if depth else ''}", unit="file"):
        name = _safe_name(html.unescape(name)) or fid
        target = dest / name
        if target.exists():
            target = dest / f"{target.stem}_{fid[:6]}{target.suffix}"
        try:
            data = _http_get(f"https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t")
            target.write_bytes(data)
            out.append(target)
        except Exception as e:
            log.warning("Could not download %s (%s): %s", name, fid, e)
    if depth < 3:
        for fid, name in folders:
            out += fetch_drive_folder(f"https://drive.google.com/drive/folders/{fid}",
                                      dest / (_safe_name(html.unescape(name)) or fid), depth + 1)
    return out


def _http_get(url: str, tries: int = 3) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 sticker-pipeline"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # network hiccups: retry with backoff
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def _safe_name(name: str) -> str:
    name = os.path.basename(name.replace("\\", "/")).strip()
    return re.sub(r'[\x00-\x1f<>:"|?*]', "_", name).lstrip(".")


def safe_extract_zip(zpath: Path, dest: Path) -> None:
    """Extract a ZIP without letting entries escape `dest` (zip-slip)."""
    dest = dest.resolve()
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            if info.is_dir() or info.filename.startswith("__MACOSX/"):
                continue
            target = (dest / info.filename).resolve()
            if not str(target).startswith(str(dest) + os.sep):
                log.warning("Skipping unsafe ZIP entry %r", info.filename)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def collect_inputs(src: str, work: Path) -> tuple[Path, list[Path], list[dict]]:
    """Return (root, image paths, skipped-file records)."""
    if re.match(r"https?://", src):
        root = work / "drive_download"
        fetch_drive_folder(src, root)
    else:
        p = Path(src).expanduser()
        if not p.exists():
            raise FileNotFoundError(f"Input not found: {p}")
        if p.is_file() and p.suffix.lower() == ".zip":
            root = work / "zip_extracted"
            safe_extract_zip(p, root)
        elif p.is_file():
            root = p.parent
            return root, [p], []
        else:
            root = p
    images, skipped = [], []
    for f in sorted(root.rglob("*")):
        if not f.is_file() or f.name.startswith(".") or "__MACOSX" in f.parts:
            continue
        ext = f.suffix.lower()
        if ext == ".zip":  # nested ZIPs: extract alongside and include
            sub = work / "nested_zips" / f.stem
            try:
                safe_extract_zip(f, sub)
                _, imgs, sk = collect_inputs(str(sub), work)
                images += imgs
                skipped += sk
            except Exception as e:
                skipped.append({"file": str(f.relative_to(root)), "reason": f"bad zip: {e}"})
        elif ext in IMAGE_EXTS:
            if ext in (".heic", ".heif") and not HEIF_OK:
                skipped.append({"file": str(f.relative_to(root)),
                                "reason": "HEIC needs `pip install pillow-heif`"})
            else:
                images.append(f)
        else:
            skipped.append({"file": str(f.relative_to(root)), "reason": f"not an image ({ext or 'no extension'})"})
    return root, images, skipped


def pack_slug(path: Path, index: int) -> str:
    """'WhatsApp Image 2026-10-22 at 12.57.53 (2).jpeg' -> '003_wa_2026-10-22_12-57-53_2'."""
    stem = path.stem
    m = re.match(r"WhatsApp Image (\d{4}-\d{2}-\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})(?: \((\d+)\))?", stem)
    if m:
        d, hh, mm, ss, n = m.groups()
        slug = f"wa_{d}_{int(hh):02d}-{mm}-{ss}" + (f"_{n}" if n else "")
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")[:48] or "image"
    return f"{index:03d}_{slug}"


def load_image(path: Path) -> tuple[Image.Image, list[str]]:
    notes = []
    im = Image.open(path)
    if getattr(im, "n_frames", 1) > 1:
        notes.append(f"animated ({im.n_frames} frames) - first frame used")
        im.seek(0)
    im = ImageOps.exif_transpose(im)
    if im.mode in ("P", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
    if im.mode == "I;16" or im.mode == "I":
        im = im.point(lambda v: v / 256).convert("L")
    im = im.convert("RGBA")
    return im, notes


# --------------------------------------------------------------------------
# 2. Grid / contact-sheet detection
# --------------------------------------------------------------------------

def _border_ring(a: np.ndarray, w: int = 2) -> np.ndarray:
    return np.concatenate([a[:w].reshape(-1, a.shape[-1]), a[-w:].reshape(-1, a.shape[-1]),
                           a[:, :w].reshape(-1, a.shape[-1]), a[:, -w:].reshape(-1, a.shape[-1])])


def dominant_color(px: np.ndarray) -> np.ndarray:
    q = (px[:, :3] // 4).astype(np.int32)
    keys = q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    k = vals[counts.argmax()]
    sel = px[keys == k][:, :3]
    return np.median(sel, axis=0)


def _runs(on: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    """Runs of True in `on`, merging runs separated by gaps shorter than min_gap."""
    idx = np.flatnonzero(np.diff(np.concatenate([[0], on.astype(np.int8), [0]])))
    segs = [(int(s), int(e)) for s, e in zip(idx[::2], idx[1::2])]
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def xy_cut(mask: np.ndarray, box: tuple[int, int, int, int], min_gap: int, depth: int = 0) -> list[tuple]:
    """Recursive XY-cut: split on fully empty rows/columns (gutters)."""
    x0, y0, x1, y1 = box
    sub = mask[y0:y1, x0:x1]
    if sub.size == 0 or not sub.any():
        return []
    ys = np.flatnonzero(sub.any(1))
    xs = np.flatnonzero(sub.any(0))
    x0, x1, y0, y1 = x0 + xs[0], x0 + xs[-1] + 1, y0 + ys[0], y0 + ys[-1] + 1
    sub = mask[y0:y1, x0:x1]
    if depth > 6:
        return [(x0, y0, x1, y1)]
    for axis in (1, 0):  # rows first, then columns
        prof = sub.mean(axis=axis)
        segs = _runs(prof > 0.003, min_gap)
        if len(segs) > 1:
            out = []
            for s, e in segs:
                b = (x0, y0 + s, x1, y0 + e) if axis == 1 else (x0 + s, y0, x0 + e, y1)
                out += xy_cut(mask, b, min_gap, depth + 1)
            return out
    return [(x0, y0, x1, y1)]


def is_card(rgb: np.ndarray, box, page: np.ndarray) -> tuple[bool, np.ndarray | None]:
    """Does this box look like a sticker tile: a uniform rim distinct from the page?"""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w < 24 or h < 24:
        return False, None
    inset = max(3, int(0.012 * min(w, h)))
    crop = rgb[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
    if crop.shape[0] < 10 or crop.shape[1] < 10:
        return False, None
    ring = _border_ring(crop.astype(np.int16), 3)
    c = dominant_color(ring)
    match = np.abs(ring[:, :3] - c).max(1) <= 12
    distinct = np.abs(c - page).max() > 4
    return bool(match.mean() >= 0.55 and distinct), c


def detect_layout(rgba: Image.Image) -> dict:
    """Decide single vs grid and return tile boxes with per-tile verdicts."""
    a = np.asarray(rgba)
    rgb = a[..., :3].astype(np.int16)
    alpha = a[..., 3]
    H, W = alpha.shape
    has_alpha = alpha.min() < 250
    if has_alpha:
        mask = alpha > 8
        page = np.array([255, 255, 255])
    else:
        page = dominant_color(_border_ring(rgb, 2))
        mask = np.abs(rgb - page).max(2) > 6
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # Thin divider lines running across the sheet would glue rows/columns
    # together; drop straight runs longer than 60% of the image that are <7px thick.
    for k_long, k_thick in (((int(0.6 * W), 1), (1, 7)), ((1, int(0.6 * H)), (7, 1))):
        if min(k_long) < 1 or max(k_long) < 20:
            continue
        line = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones(k_long[::-1], np.uint8))
        thick = cv2.morphologyEx(line, cv2.MORPH_OPEN, np.ones(k_thick[::-1], np.uint8))
        mask[(line > 0) & (thick == 0)] = 0
    mask = mask.astype(bool)
    min_gap = max(6, int(0.006 * max(H, W)))
    leaves = xy_cut(mask, (0, 0, W, H), min_gap)
    res = {"page": page.tolist(), "has_alpha": bool(has_alpha), "tiles": [], "flags": [], "fragments": 0}

    if not leaves:
        res["kind"] = "empty"
        res["flags"].append("image is blank / a single flat colour")
        return res

    fragments = [b for b in leaves if min(b[2] - b[0], b[3] - b[1]) < 12]
    leaves = [b for b in leaves if b not in fragments]
    res["fragments"] = len(fragments)
    if fragments:
        res["notes"] = [f"{len(fragments)} thin sliver(s) under 12px ignored (cut-off edge of a tile / divider)"]
    if len(leaves) <= 1:
        b = leaves[0] if leaves else (0, 0, W, H)
        card, bg = is_card(rgb, b, page) if not has_alpha else (False, None)
        res["kind"] = "single"
        res["tiles"].append({"box": b, "row": 1, "col": 1, "card": card, "status": "ok", "flags": []})
        return res

    areas = np.array([(b[2] - b[0]) * (b[3] - b[1]) for b in leaves])
    big = [b for b, ar in zip(leaves, areas) if ar >= 0.25 * areas.max()]
    mw = float(np.median([b[2] - b[0] for b in big]))
    mh = float(np.median([b[3] - b[1] for b in big]))
    tiles = []
    for b in leaves:
        w, h = b[2] - b[0], b[3] - b[1]
        edge = b[0] <= 3 or b[1] <= 3 or b[2] >= W - 3 or b[3] >= H - 3
        t = {"box": b, "flags": [], "status": "ok", "card": False}
        if (w < 0.8 * mw or h < 0.8 * mh) and edge:
            t["status"] = "partial"
            t["flags"].append(f"cut off at the image edge ({w}x{h} vs typical {mw:.0f}x{mh:.0f})")
        elif w > 1.6 * mw or h > 1.6 * mh:
            t["status"] = "merged"
            t["flags"].append("larger than its neighbours - may be several pictures with no visible gutter")
        elif w < 0.8 * mw or h < 0.8 * mh:
            t["flags"].append(f"irregular size ({w}x{h} vs typical {mw:.0f}x{mh:.0f})")
        elif edge and (w < 0.92 * mw or h < 0.92 * mh):
            t["flags"].append("touches the image edge and is slightly small - may be clipped")
        if t["status"] == "ok" and not has_alpha:
            t["card"], _ = is_card(rgb, b, page)
        tiles.append(t)

    full = [t for t in tiles if t["status"] == "ok"]
    cards = sum(t["card"] for t in full)
    if has_alpha or (full and cards >= 0.8 * len(full)):
        res["kind"] = "grid"
    else:
        sizes_ok = all(abs((t["box"][2] - t["box"][0]) - mw) <= 0.15 * mw and
                       abs((t["box"][3] - t["box"][1]) - mh) <= 0.15 * mh for t in full)
        if len(full) >= 2 and sizes_ok:
            res["kind"] = "grid"
            res["flags"].append("borderless grid (no tile backgrounds) - split by gutters, please check")
            for t in full:
                t["flags"].append("borderless grid - boundaries inferred from blank gutters")
        else:
            # Pieces don't form a regular grid: don't guess. Keep the picture whole.
            res["kind"] = "single"
            res["flags"].append(f"found {len(leaves)} separate regions that don't form a regular grid - "
                                "kept whole, not split; check whether it is a collage")
            x0 = min(b[0] for b in leaves); y0 = min(b[1] for b in leaves)
            x1 = max(b[2] for b in leaves); y1 = max(b[3] for b in leaves)
            res["tiles"] = [{"box": (x0, y0, x1, y1), "row": 1, "col": 1, "card": False, "status": "ok",
                             "flags": ["possible collage - kept whole"]}]
            return res

    # Row / column indices from tile centres
    def _index(vals, step):
        order = sorted(set(vals))
        groups, cur = {}, 0
        for i, v in enumerate(order):
            if i and v - order[i - 1] > 0.5 * step:
                cur += 1
            groups[v] = cur + 1
        return groups
    cy = [int((t["box"][1] + t["box"][3]) / 2) for t in tiles]
    cx = [int((t["box"][0] + t["box"][2]) / 2) for t in tiles]
    ry, rx = _index(cy, mh), _index(cx, mw)
    for t, y, x in zip(tiles, cy, cx):
        t["row"], t["col"] = ry[y], rx[x]
    tiles.sort(key=lambda t: (t["row"], t["col"]))
    res["tiles"] = tiles
    res["grid"] = f"{max(t['row'] for t in tiles)} rows x {max(t['col'] for t in tiles)} cols"
    return res


def save_overlay(rgba: Image.Image, layout: dict, path: Path) -> None:
    im = rgba.convert("RGB")
    d = ImageDraw.Draw(im)
    colors = {"ok": (22, 163, 74), "flag": (234, 138, 0), "partial": (220, 38, 38), "merged": (220, 38, 38)}
    lw = max(2, im.width // 400)
    for t in layout["tiles"]:
        c = colors["flag"] if (t["status"] == "ok" and t["flags"]) else colors[t["status"] if t["status"] in colors else "partial"]
        d.rectangle(t["box"], outline=c, width=lw)
        d.text((t["box"][0] + 6, t["box"][1] + 4), f"r{t.get('row', '?')}c{t.get('col', '?')} {t['status']}", fill=c)
    im.thumbnail((1400, 1400))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=85)


# --------------------------------------------------------------------------
# 3. Background removal (matte)
# --------------------------------------------------------------------------

def make_alpha(rgb: np.ndarray, page: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, dict]:
    """Colour-key the flat tile background out, flood-filling from the edges.

    Only background connected to the border (plus large enclosed pockets of the
    exact background colour) is removed, so outlines stop the fill and white or
    pale subjects survive. Returns (alpha uint8, decontaminated rgb, info).
    """
    H, W = rgb.shape[:2]
    rgbi = rgb.astype(np.int16)
    ring = _border_ring(rgbi, 3)
    bg = dominant_color(ring)
    ring_d = np.abs(ring - bg).max(1)
    uniform = float((ring_d <= 12).mean())
    info = {"bg": "#%02x%02x%02x" % tuple(int(v) for v in bg), "uniform": round(uniform, 2), "holes": 0}
    alpha = np.full((H, W), 255, np.uint8)
    if uniform < 0.6:
        info["mode"] = "none"  # photo / art running to the edges: nothing flat to remove
        if page is not None:
            alpha = _corner_cleanup(rgbi, alpha, page)
        return alpha, rgb, info

    noise = float(np.percentile(ring_d[ring_d <= 12], 90)) if (ring_d <= 12).any() else 2.0
    tol = float(np.clip(noise * 1.5 + 5, 6, 22))
    info["tol"] = round(tol, 1)
    dist = np.abs(rgbi - bg).max(2)
    cand = (dist <= tol).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cand, connectivity=4)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border > 0]
    # Enclosed pockets of background (gaps between arm and body etc.): big
    # components whose colour sits right on the background colour
    min_hole = max(80, int(0.002 * H * W))
    mean_d = np.bincount(lab.ravel(), weights=dist.ravel(), minlength=n) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
    is_bg = np.zeros(n, bool)
    is_bg[border] = True
    holes = (stats[:, cv2.CC_STAT_AREA] >= min_hole) & (mean_d <= tol * 0.5) & ~is_bg
    holes[0] = False
    info["holes"] = int(holes.sum())
    bgmask = (is_bg | holes)[lab]
    if page is not None:
        bgmask |= _corner_cleanup(rgbi, np.full((H, W), 255, np.uint8), page) == 0

    # Soft edge: pixels just outside the hard mask get partial alpha by colour distance
    near = cv2.dilate(bgmask.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~bgmask
    soft = np.clip((dist - tol) / (tol * 3.0), 0, 1)
    a = np.where(bgmask, 0.0, np.where(near, soft, 1.0))
    # Drop single-pixel JPEG specks left floating in the background
    fg = (a > 0.1).astype(np.uint8)
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    speck = max(4, int(0.00002 * H * W))
    tiny = st2[:, cv2.CC_STAT_AREA] <= speck
    tiny[0] = False
    a[tiny[lab2]] = 0
    # Colour decontamination: remove the background tint mixed into edge pixels
    out = rgb.astype(np.float32)
    edge = (a > 0) & (a < 1)
    if edge.any():
        ae = a[edge][:, None]
        out[edge] = np.clip((out[edge] - (1 - ae) * bg) / np.maximum(ae, 0.15), 0, 255)
    info["mode"] = "colour-key"
    return (a * 255).astype(np.uint8), out.astype(np.uint8), info


def _corner_cleanup(rgbi: np.ndarray, alpha: np.ndarray, page: np.ndarray) -> np.ndarray:
    """Clear page-coloured rounded-corner wedges (screenshots of rounded cards)."""
    H, W = alpha.shape
    r = max(4, int(0.12 * min(H, W)))
    close = (np.abs(rgbi - page).max(2) <= 10).astype(np.uint8)
    out = alpha.copy()
    for ys, xs in ((slice(0, r), slice(0, r)), (slice(0, r), slice(W - r, W)),
                   (slice(H - r, H), slice(0, r)), (slice(H - r, H), slice(W - r, W))):
        box = close[ys, xs].copy()
        cy = 0 if ys.start == 0 else box.shape[0] - 1
        cx = 0 if xs.start == 0 else box.shape[1] - 1
        if not box[cy, cx]:
            continue
        ff = np.zeros((box.shape[0] + 2, box.shape[1] + 2), np.uint8)
        cv2.floodFill(box, ff, (cx, cy), 2, flags=4)
        sub = out[ys, xs]
        sub[box == 2] = 0
        out[ys, xs] = sub
    return out


def refine_alpha(lo_alpha: np.ndarray, hi_alpha: np.ndarray) -> np.ndarray:
    """Low-res matte decides inside/outside; high-res matte only shapes the edge band."""
    H, W = hi_alpha.shape
    up = cv2.resize(lo_alpha, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    band = (up > 0.02) & (up < 0.98)
    band = cv2.dilate(band.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    out = (up >= 0.5).astype(np.float32)
    hi = hi_alpha.astype(np.float32) / 255
    out[band] = np.clip(hi[band], up[band] - 0.4, up[band] + 0.4)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def rembg_alpha(rgb: np.ndarray) -> np.ndarray | None:
    try:
        from rembg import new_session, remove
    except ImportError:
        return None
    global _REMBG
    if "_REMBG" not in globals():
        _REMBG = new_session("isnet-general-use")
    res = remove(Image.fromarray(rgb), session=_REMBG, post_process_mask=True)
    return np.asarray(res.convert("RGBA"))[..., 3]


def classify_art(rgb: np.ndarray, alpha: np.ndarray, mode: str) -> str:
    """'art' (drawn: flat fills, ink outlines) or 'photo' - picks the upscaling model.

    Two cues measured on the subject: how well a 16-colour palette reproduces
    its smooth areas (drawings ~0-5, photos ~5-15), and how many strong edges
    are thin dark ink lines (cartoons 0.2-0.8, photos under 0.15). Wrongly
    calling a photo 'art' paints it like an anime frame, so ties go to 'photo'.
    """
    if mode == "none":
        return "photo"
    fg = cv2.erode((alpha > 128).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    if fg.sum() < 200:
        return "art"
    sm = cv2.bilateralFilter(np.ascontiguousarray(rgb), 5, 30, 5)
    q = np.asarray(Image.fromarray(sm).quantize(16, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
                   .convert("RGB")).astype(np.float32)
    err = np.abs(q - sm.astype(np.float32)).max(2)
    g = cv2.cvtColor(sm, cv2.COLOR_RGB2GRAY)
    gf = g.astype(np.float32)
    grad = cv2.magnitude(cv2.Sobel(gf, cv2.CV_32F, 1, 0), cv2.Sobel(gf, cv2.CV_32F, 0, 1))
    smooth = fg & (grad < 40)
    qerr = float(np.median(err[smooth])) if smooth.sum() > 100 else 0.0
    ink = (cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, np.ones((5, 5), np.uint8)) > 50) & (g < 90)
    strong = fg & (grad > 120)
    outline = float(cv2.dilate(ink.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)[strong].mean()) \
        if strong.sum() > 50 else 0.0
    if qerr <= 1 or (qerr <= 5 and outline >= 0.2) or (qerr <= 9 and outline >= 0.3):
        return "art"
    return "photo"


def blur_score(rgb: np.ndarray, alpha: np.ndarray) -> float:
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(g, cv2.CV_64F)
    m = cv2.erode((alpha > 128).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    return float(lap[m].var()) if m.sum() > 100 else float(lap.var())


# --------------------------------------------------------------------------
# 4. Upscaling
# --------------------------------------------------------------------------

def find_realesrgan() -> tuple[Path, Path] | None:
    exe = "realesrgan-ncnn-vulkan.exe" if os.name == "nt" else "realesrgan-ncnn-vulkan"
    env = os.environ.get("REALESRGAN_BIN")
    cands = [Path(env)] if env else []
    cands += list(TOOLS.rglob(exe))
    on_path = shutil.which(exe)
    if on_path:
        cands.append(Path(on_path))
    for c in cands:
        if c.is_file():
            models = c.parent / "models"
            if models.is_dir():
                return c, models
    return None


DUP_EDGE_MATCH = 0.86  # outline correlation needed to call two stickers the same
DUP_MAYBE = 0.75       # between the two: keep both, flag for review

MODELS = {"art": "realesrgan-x4plus-anime", "photo": "realesrgan-x4plus"}


def realesrgan_batch(exe: Path, models: Path, model: str, in_dir: Path, out_dir: Path, n: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(exe, 0o755)
    cmd = [str(exe), "-i", str(in_dir), "-o", str(out_dir), "-n", model, "-s", "4", "-f", "png", "-m", str(models)]
    log.info("Running: %s", " ".join(cmd))
    errlog = open(out_dir.parent / f"realesrgan_{model}.log", "w")
    proc = subprocess.Popen(cmd, stdout=errlog, stderr=subprocess.STDOUT)
    bar = tqdm(total=n, desc=f"AI upscaling ({model})", unit="img")
    done = 0
    while proc.poll() is None:
        time.sleep(0.5)
        now = len(list(out_dir.glob("*.png")))
        bar.update(now - done)
        done = now
    bar.update(len(list(out_dir.glob("*.png"))) - done)
    bar.close()
    errlog.close()
    if proc.returncode != 0:
        raise RuntimeError(f"Real-ESRGAN exited with code {proc.returncode} (see {errlog.name})")


def lanczos_upscale(im: Image.Image, factor: float) -> Image.Image:
    w, h = im.size
    big = im.resize((max(1, round(w * factor)), max(1, round(h * factor))), Image.LANCZOS)
    return big.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))


# --------------------------------------------------------------------------
# 5. Export helpers
# --------------------------------------------------------------------------

def fit_on_canvas(rgba: Image.Image, margin: int, square: bool) -> Image.Image:
    """Fit the subject inside (512 - 2*margin) keeping aspect ratio, centred."""
    inner = STICKER - 2 * margin
    w, h = rgba.size
    s = inner / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    resized = rgba.resize((nw, nh), Image.LANCZOS, reducing_gap=3.0 if s < 0.5 else None)
    if not square:
        canvas = Image.new("RGBA", (nw + 2 * margin, nh + 2 * margin), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGBA", (STICKER, STICKER), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((canvas.width - nw) // 2, (canvas.height - nh) // 2))
    return canvas


def save_webp(img: Image.Image, path: Path, limit: int = 100 * 1024) -> int:
    for q in (90, 80, 70, 60, 50, 40, 30):
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=4)
        if buf.tell() <= limit or q == 30:
            path.write_bytes(buf.getvalue())
            return buf.tell()
    return 0


def sticker_signature(img: Image.Image) -> dict:
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    al = a[..., 3:4] / 255
    comp = a[..., :3] * al + 128 * (1 - al)
    g = cv2.cvtColor(comp.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    small = cv2.resize(g, (17, 16), interpolation=cv2.INTER_AREA).astype(np.int16)
    dh = np.packbits((small[:, 1:] > small[:, :-1]).flatten())
    m = cv2.resize(a[..., 3], (32, 32), interpolation=cv2.INTER_AREA) > 64
    col = cv2.resize(comp.astype(np.uint8), (8, 8), interpolation=cv2.INTER_AREA).astype(np.float32)
    return {"dhash": dh, "mask": m, "col": col}


def is_duplicate(s1: dict, s2: dict) -> bool:
    """Cheap prefilter on the exported stickers; edge_match() makes the final call."""
    ham = int(np.unpackbits(np.bitwise_xor(s1["dhash"], s2["dhash"])).sum())
    inter = (s1["mask"] & s2["mask"]).sum()
    union = (s1["mask"] | s2["mask"]).sum() or 1
    coldiff = float(np.abs(s1["col"] - s2["col"]).mean())
    return ham <= 56 and inter / union >= 0.82 and coldiff <= 16


def _edges(path: str) -> np.ndarray:
    g = cv2.cvtColor(np.asarray(Image.open(path).convert("RGB")), cv2.COLOR_RGB2GRAY)
    g = cv2.GaussianBlur(g, (3, 3), 0).astype(np.float32)
    m = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    return cv2.GaussianBlur(m, (5, 5), 0)


def edge_match(crop_a: str, crop_b: str) -> float:
    """Outline correlation of two source crops, compared at the same scale.

    Repeats of a sticker across overlapping screenshots line up almost exactly
    once scaled to match, while look-alikes (same character, different face)
    don't. The central 80% of the smaller crop is slid over the other at a few
    nearby scales, so screenshot zoom and a clipped edge don't matter.
    """
    a, b = _edges(crop_a), _edges(crop_b)
    if a.size > b.size:
        a, b = b, a
    my, mx = int(a.shape[0] * 0.1), int(a.shape[1] * 0.1)
    tpl = a[my:a.shape[0] - my, mx:a.shape[1] - mx]
    if tpl.std() < 1e-3:
        return 0.0
    r0 = (a.shape[0] / b.shape[0] + a.shape[1] / b.shape[1]) / 2
    best = 0.0
    for k in (0.92, 0.96, 1.0, 1.04, 1.08):
        r = r0 * k
        bb = cv2.resize(b, (max(1, round(b.shape[1] * r)), max(1, round(b.shape[0] * r))), interpolation=cv2.INTER_AREA)
        pad_y, pad_x = max(0, tpl.shape[0] - bb.shape[0]), max(0, tpl.shape[1] - bb.shape[1])
        if pad_y or pad_x:
            bb = np.pad(bb, ((0, pad_y), (0, pad_x)))
        best = max(best, float(cv2.matchTemplate(bb, tpl, cv2.TM_CCOEFF_NORMED).max()))
    return best


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------

def run(args) -> int:
    t0 = time.time()
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(args.output or (HERE / "output" / f"stickers-{stamp}")).resolve()
    work = out / "_work"
    for d in ("stickers", "whatsapp_webp", "duplicates", "review", "originals", "debug/grid_overlays"):
        (out / d).mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(out / "run.log"), logging.StreamHandler(sys.stderr)])
    log.info("Output folder: %s", out)

    # ---- 1. collect
    if not re.match(r"https?://", args.input):
        ip = Path(args.input).expanduser().resolve()
        if ip.is_dir() and (ip == out or ip in out.parents):
            raise SystemExit("The output folder must not be inside the input folder.")
    root, images, skipped = collect_inputs(args.input, work)
    log.info("Found %d images (%d other files skipped)", len(images), len(skipped))
    if not images:
        log.error("No images found in %s", args.input)
        return 2

    sources, tiles = [], []
    upscaler = None if args.upscaler == "lanczos" else find_realesrgan()
    if args.upscaler == "realesrgan" and not upscaler:
        raise SystemExit("Real-ESRGAN not found. Run ./setup.sh (or set REALESRGAN_BIN).")
    if not upscaler:
        log.warning("AI upscaler not installed - falling back to Lanczos + unsharp mask. Run ./setup.sh for AI upscaling.")

    # ---- 2. detect + crop
    crops_dir = work / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)
    for i, path in enumerate(tqdm(images, desc="Detecting grids", unit="img"), 1):
        rel = path.relative_to(root) if root in path.parents or path.parent == root else Path(path.name)
        pack = pack_slug(path, i)
        src = {"file": str(rel), "pack": pack, "status": "ok", "flags": [], "tiles": 0, "exported": 0}
        sources.append(src)
        try:
            dst = out / "originals" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dst)
            im, notes = load_image(path)
            src["flags"] += notes
            src["size"] = f"{im.width}x{im.height}"
            layout = detect_layout(im)
            src["kind"] = layout["kind"]
            src["grid"] = layout.get("grid", "")
            src["flags"] += layout["flags"]
            src["notes"] = layout.get("notes", [])
            src["fragments"] = layout["fragments"]
            src["tiles"] = len(layout["tiles"])
            save_overlay(im, layout, out / "debug" / "grid_overlays" / f"{pack}.jpg")
            page = np.array(layout["page"], dtype=np.float32)
            arr = np.asarray(im)
            for t in layout["tiles"]:
                x0, y0, x1, y1 = t["box"]
                if t["card"]:
                    ins = max(3, int(0.012 * min(x1 - x0, y1 - y0)))
                    x0, y0, x1, y1 = x0 + ins, y0 + ins, x1 - ins, y1 - ins
                name = pack if layout["kind"] == "single" else f"{pack}_r{t['row']}c{t['col']}"
                rec = {"id": name, "source": str(rel), "pack": pack, "row": t["row"], "col": t["col"],
                       "status": t["status"], "flags": list(t["flags"]), "decisions": [],
                       "box": [int(v) for v in t["box"]], "src_alpha": layout["has_alpha"]}
                if layout["kind"] == "single":
                    rec["decisions"].append("single image - not split")
                else:
                    rec["decisions"].append(f"tile r{t['row']}c{t['col']} of {layout['grid']} grid"
                                            + (" (tile background detected)" if t["card"] else ""))
                tile_arr = arr[y0:y1, x0:x1]
                if t["status"] != "ok":
                    Image.fromarray(tile_arr).save(out / "review" / f"{name}__{t['status']}.png")
                    rec["decisions"].append(f"not exported - {t['status']}; crop saved to review/")
                    tiles.append(rec)
                    continue
                prepare_tile(rec, tile_arr, page if not t["card"] else None, crops_dir, args)
                tiles.append(rec)
        except Exception as e:
            src["status"] = "error"
            src["flags"].append(f"error: {e}")
            log.error("Failed on %s: %s\n%s", rel, e, traceback.format_exc())

    # ---- 3. upscale
    todo = [t for t in tiles if t.get("upscale")]
    if todo and upscaler:
        for kind, model in MODELS.items():
            group = [t for t in todo if t["kind"] == kind]
            if not group:
                continue
            in_dir, out_dir = work / f"up_in_{kind}", work / f"up_out_{kind}"
            in_dir.mkdir(exist_ok=True)
            out_dir.mkdir(exist_ok=True)
            # Cache upscales by crop content so re-runs skip the slow GPU step
            cache = HERE / ".cache" / "upscale" / model
            cache.mkdir(parents=True, exist_ok=True)
            fresh = 0
            for t in group:
                t["crop_hash"] = hashlib.sha1(Path(t["crop"]).read_bytes()).hexdigest()
                hit = cache / f"{t['crop_hash']}.png"
                if hit.exists():
                    shutil.copy2(hit, out_dir / Path(t["crop"]).name)
                else:
                    shutil.copy2(t["crop"], in_dir / Path(t["crop"]).name)
                    fresh += 1
            log.info("%s: %d to upscale, %d from cache", model, fresh, len(group) - fresh)
            if fresh:
                try:
                    realesrgan_batch(upscaler[0], upscaler[1], model, in_dir, out_dir, fresh)
                except Exception as e:
                    log.error("AI upscaling failed (%s) - using Lanczos for the rest", e)
            for t in group:
                p = out_dir / Path(t["crop"]).name
                if p.exists():
                    shutil.copy2(p, cache / f"{t['crop_hash']}.png")
                    t["upscaled"] = str(p)
                    t["upscale_method"] = f"Real-ESRGAN {model} x4"
                    if kind == "photo" and args.photo_ai < 1:
                        t["upscale_method"] += f", blended {args.photo_ai:.0%} with Lanczos to keep photo texture"

    # ---- 4/5. matte + export
    exported = []
    for t in tqdm([t for t in tiles if t["status"] == "ok" and t.get("crop")], desc="Matting + exporting", unit="sticker"):
        try:
            finish_tile(t, work, args)
            exported.append(t)
        except Exception as e:
            t["status"] = "error"
            t["flags"].append(f"error: {e}")
            log.error("Export failed for %s: %s\n%s", t["id"], e, traceback.format_exc())

    # duplicates: keep the sharpest/largest copy of each sticker
    exported.sort(key=lambda t: -t.get("subject_px", 0))
    kept = []
    for t in exported:
        if args.keep_duplicates:
            kept.append(t)
            continue
        dup = None
        for k in kept:
            if is_duplicate(t["sig"], k["sig"]):
                score = edge_match(t["crop"], k["crop"])
                if score >= DUP_EDGE_MATCH:
                    dup, t["dup_score"] = k, round(score, 3)
                    break
                if score >= DUP_MAYBE:
                    t["flags"].append(f"looks very like {k['id']} (match {score:.2f}) - kept both; "
                                      "delete one if they're the same sticker")
        if dup:
            t["status"] = "duplicate"
            t["duplicate_of"] = dup["id"]
            t["decisions"].append(f"duplicate of {dup['id']} (kept the higher-resolution copy) - moved to duplicates/")
        else:
            kept.append(t)
    for t in exported:
        final = Image.open(t["final"])
        if t["status"] == "duplicate":
            dst = out / "duplicates" / f"{t['id']}__dup-of__{t['duplicate_of']}.png"
            final.save(dst, optimize=True)
            t["output"] = str(dst.relative_to(out))
        else:
            d = out / "stickers" / t["pack"]
            d.mkdir(exist_ok=True)
            dst = d / f"{t['id']}.png"
            final.save(dst, optimize=True)
            t["output"] = str(dst.relative_to(out))
            if not args.no_webp:
                wd = out / "whatsapp_webp" / t["pack"]
                wd.mkdir(exist_ok=True)
                t["webp_kb"] = round(save_webp(final, wd / f"{t['id']}.webp") / 1024, 1)
            t["status"] = "exported"
            if t["flags"]:
                shutil.copy2(dst, out / "review" / f"{t['id']}__check.png")
    for s in sources:
        s["exported"] = sum(1 for t in tiles if t["source"] == s["file"] and t["status"] == "exported")

    # ---- 6. report + zip
    for d in ("duplicates", "review", "whatsapp_webp"):  # drop empty optional folders
        p = out / d
        if p.exists() and not any(p.rglob("*")):
            p.rmdir()
    summary = write_reports(out, sources, tiles, skipped, upscaler, args, time.time() - t0)
    if not args.keep_work:
        shutil.rmtree(work, ignore_errors=True)
    zpath = out.parent / f"{out.name}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.rglob("*")):
            if f.is_file() and "_work" not in f.parts:
                z.write(f, Path(out.name) / f.relative_to(out))
    print("\n" + summary)
    print(f"\nFolder: {out}\nZIP:    {zpath}  ({zpath.stat().st_size / 1e6:.1f} MB)")
    return 0


def prepare_tile(rec: dict, tile: np.ndarray, page, crops_dir: Path, args) -> None:
    """Find the subject at source resolution, crop with padding, decide on upscaling."""
    rgb, src_alpha = tile[..., :3].copy(), tile[..., 3]
    if rec["src_alpha"]:
        alpha, info = src_alpha.copy(), {"mode": "source-alpha"}
        if src_alpha.min() < 250:  # flatten onto the edge colour for the upscaler
            bgc = np.median(rgb[src_alpha > 200], axis=0) if (src_alpha > 200).any() else np.array([255, 255, 255])
            edge = cv2.dilate((src_alpha > 8).astype(np.uint8), np.ones((5, 5), np.uint8)) & (src_alpha <= 8)
            if edge.any():
                bgc = np.median(rgb[edge.astype(bool)], axis=0)
            a = src_alpha[..., None] / 255.0
            rgb = (rgb * a + bgc * (1 - a)).astype(np.uint8)
    else:
        alpha, _, info = make_alpha(rgb, page)
    ys, xs = np.nonzero(alpha > 24)
    if len(ys) < 30:
        rec["status"] = "empty"
        rec["flags"].append("no subject found (blank tile)")
        rec["decisions"].append("not exported - blank")
        return
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    pad = max(6, int(0.04 * max(x1 - x0, y1 - y0)))
    H, W = alpha.shape
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    crop_rgb = rgb[y0:y1, x0:x1]
    crop_a = alpha[y0:y1, x0:x1]
    sw, sh = int(xs.max() + 1 - xs.min()), int(ys.max() + 1 - ys.min())
    rec["subject_px"] = sw * sh
    rec["src_subject"] = f"{sw}x{sh}"
    rec["kind"] = classify_art(crop_rgb, crop_a, info["mode"])
    rec["blur"] = round(blur_score(crop_rgb, crop_a), 1)
    rec["bg_info"] = info
    rec["page"] = page.tolist() if page is not None else None
    if info["mode"] == "colour-key":
        rec["decisions"].append(f"background: flat tile colour {info['bg']} keyed out from the edges"
                                + (f", {info['holes']} enclosed pocket(s)" if info["holes"] else ""))
    elif info["mode"] == "source-alpha":
        rec["decisions"].append("background: kept the image's existing transparency")
    full_frame = sw >= 0.97 * W and sh >= 0.97 * H and info["mode"] != "source-alpha"
    rec["full_frame"] = bool(info["mode"] == "none" or full_frame)
    target = STICKER - 2 * args.margin
    factor = target / max(sw, sh)
    rec["needed_scale"] = round(factor, 2)
    if rec["blur"] < 60:
        rec["decisions"].append(f"soft/blurry source (sharpness {rec['blur']:.0f})")
    if factor > 1.05 or (rec["blur"] < 60 and factor > 0.8):
        rec["upscale"] = True
        if factor > 6:
            rec["flags"].append(f"very low resolution ({sw}x{sh}px needs x{factor:.1f}) - check quality")
    p = crops_dir / f"{rec['id']}.png"
    Image.fromarray(crop_rgb).save(p)
    rec["crop"] = str(p)
    if rec["src_alpha"]:
        ap = crops_dir / f"{rec['id']}__alpha.png"
        Image.fromarray(crop_a).save(ap)
        rec["alpha_file"] = str(ap)


def finish_tile(rec: dict, work: Path, args) -> None:
    lo = Image.open(rec["crop"]).convert("RGB")
    src = Image.open(rec["upscaled"]).convert("RGB") if rec.get("upscaled") else lo
    if rec.get("upscaled") and rec["kind"] == "photo" and args.photo_ai < 1:
        # Real-ESRGAN repaints low-res photo detail (skin, fur) as smooth
        # strokes; mixing in a plain resample brings back the real texture.
        soft = lanczos_upscale(lo, src.width / lo.width).resize(src.size, Image.LANCZOS)
        src = Image.blend(soft, src, args.photo_ai)
    if rec.get("upscale") and not rec.get("upscaled"):
        src = lanczos_upscale(lo, min(4.0, max(1.0, rec["needed_scale"] * 1.1)))
        rec["upscale_method"] = "Lanczos + unsharp (AI upscaler unavailable)"
    rgb = np.asarray(src)
    page = np.array(rec["page"]) if rec.get("page") else None
    if rec.get("alpha_file"):
        a = Image.open(rec["alpha_file"]).resize(src.size, Image.LANCZOS)
        alpha = np.asarray(a)
    else:
        alpha, rgb, info = make_alpha(rgb, page)
        if src.size != lo.size:
            # Which pixels are background is decided at the original resolution,
            # where colours are faithful (upscalers can melt a white subject into a
            # near-white tile and let the fill leak in); the upscaled pass only
            # sharpens the edge.
            lo_alpha, _, _ = make_alpha(np.asarray(lo), page)
            alpha = refine_alpha(lo_alpha, alpha)
    if rec.get("full_frame"):
        if args.bg == "rembg":
            ra = rembg_alpha(rgb)
            if ra is None:
                rec["flags"].append("rembg not installed - photo background kept")
            else:
                alpha = np.minimum(alpha, ra)
                rec["decisions"].append("background: AI cut-out (rembg isnet-general-use)")
        else:
            rec["decisions"].append("full-frame photo sticker - background kept "
                                    "(use --bg rembg for an AI cut-out)")
    if args.bg == "none" and not rec["src_alpha"]:
        alpha = np.full(alpha.shape, 255, np.uint8)
    ys, xs = np.nonzero(alpha > 12)
    if len(ys) == 0:
        raise RuntimeError("matte removed everything")
    rgba = np.dstack([rgb, alpha])[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray(rgba, "RGBA")
    if rec.get("upscale_method"):
        rec["decisions"].append(f"upscaled: {rec['upscale_method']} (needed x{rec['needed_scale']})")
    final = fit_on_canvas(img, args.margin, not args.no_pad)
    rec["decisions"].append(f"cropped tight, fitted to {final.width}x{final.height}, centred, {args.margin}px margin")
    p = work / "final" / f"{rec['id']}.png"
    p.parent.mkdir(exist_ok=True)
    final.save(p)
    rec["final"] = str(p)
    rec["sig"] = sticker_signature(final)


# --------------------------------------------------------------------------
# 6. Reports
# --------------------------------------------------------------------------

def write_reports(out: Path, sources, tiles, skipped, upscaler, args, secs) -> str:
    def count(pred):
        return sum(1 for t in tiles if pred(t))
    review = [t for t in tiles if t["status"] in ("partial", "merged", "empty", "error")
              or (t["status"] == "exported" and t["flags"])]
    review_src = [s for s in sources if s["flags"] and s["status"] != "error" and any(
        "grid" in f or "regions" in f for f in s["flags"])]
    stats = {
        "source images found": len(sources),
        "source images processed": sum(1 for s in sources if s["status"] == "ok"),
        "source images failed": sum(1 for s in sources if s["status"] == "error"),
        "other files skipped": len(skipped),
        "grids / contact sheets split": sum(1 for s in sources if s.get("kind") == "grid"),
        "single images kept whole": sum(1 for s in sources if s.get("kind") == "single"),
        "tiles found": len(tiles),
        "stickers exported": count(lambda t: t["status"] == "exported"),
        "upscaled with AI (Real-ESRGAN)": count(lambda t: "Real-ESRGAN" in t.get("upscale_method", "")),
        "upscaled with Lanczos fallback": count(lambda t: "unavailable" in t.get("upscale_method", "")),
        "photo upscales blended for texture": count(lambda t: "blended" in t.get("upscale_method", "")),
        "background removed": count(lambda t: t.get("bg_info", {}).get("mode") == "colour-key"),
        "photo backgrounds kept": count(lambda t: t.get("full_frame") and t["status"] in ("exported", "duplicate")),
        "duplicates set aside": count(lambda t: t["status"] == "duplicate"),
        "partial (cut-off) tiles skipped": count(lambda t: t["status"] == "partial"),
        "blank tiles skipped": count(lambda t: t["status"] == "empty"),
        "edge slivers ignored (<12px)": sum(s.get("fragments", 0) for s in sources),
        "errors": count(lambda t: t["status"] == "error") + sum(1 for s in sources if s["status"] == "error"),
        "flagged for manual review": len(review) + len(review_src),
    }
    up = (f"Real-ESRGAN ({upscaler[0]})" if upscaler else "Lanczos fallback (AI upscaler not installed)")
    lines = ["WhatsApp sticker batch - summary", "=" * 34]
    lines += [f"{k:<34} {v}" for k, v in stats.items()]
    lines += ["", f"Upscaler: {up}", f"Background mode: {args.bg}", f"Run time: {secs:.0f}s"]
    if review or review_src:
        lines += ["", "Needs a human look:"]
        lines += [f"  - {s['file']}: {'; '.join(s['flags'])}" for s in review_src]
        lines += [f"  - {t['id']} [{t['status']}]: {'; '.join(t['flags'])}" for t in review]
    summary = "\n".join(lines)
    (out / "summary.txt").write_text(summary + "\n")

    clean = []
    for t in tiles:
        c = {k: v for k, v in t.items() if k not in ("sig", "crop", "upscaled", "final", "alpha_file", "page")}
        clean.append(c)
    (out / "report.json").write_text(json.dumps({"stats": stats, "sources": sources, "tiles": clean,
                                                 "skipped": skipped}, indent=2, default=str))
    with open(out / "report.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sticker", "source", "row", "col", "status", "output", "source_subject_px", "type",
                    "sharpness", "upscale", "flags", "decisions"])
        for t in tiles:
            w.writerow([t["id"], t["source"], t["row"], t["col"], t["status"], t.get("output", ""),
                        t.get("src_subject", ""), t.get("kind", ""), t.get("blur", ""),
                        t.get("upscale_method", ""), " | ".join(t["flags"]), " | ".join(t["decisions"])])
    (out / "report.html").write_text(render_html(stats, sources, tiles, skipped, review, review_src, up, args))
    return summary


def render_html(stats, sources, tiles, skipped, review, review_src, up, args) -> str:
    e = html.escape
    badge = {"exported": "ok", "duplicate": "dup", "partial": "bad", "merged": "bad", "empty": "bad", "error": "bad"}
    rows = "".join(f"<tr><td>{e(k)}</td><td class=n>{v}</td></tr>" for k, v in stats.items())
    rev = "".join(f"<li><b>{e(s['file'])}</b> - {e('; '.join(s['flags']))}</li>" for s in review_src)
    rev += "".join(f"<li><b>{e(t['id'])}</b> <span class='b {badge.get(t['status'], 'ok')}'>{t['status']}</span> "
                   f"- {e('; '.join(t['flags']))}</li>" for t in review)
    body = []
    for s in sources:
        ts = [t for t in tiles if t["source"] == s["file"]]
        cards = []
        for t in ts:
            img = t.get("output") or (f"review/{t['id']}__{t['status']}.png" if t["status"] in ("partial", "merged") else "")
            cards.append(
                f"<div class='card'>{f'<img loading=lazy src={chr(34)}{e(img)}{chr(34)}>' if img else '<div class=ph>-</div>'}"
                f"<div class=nm>{e(t['id'].split('_')[-1] if '_r' in t['id'] else 'single')}"
                f" <span class='b {badge.get(t['status'], 'ok')}'>{t['status']}</span></div>"
                f"<div class=d>{'<br>'.join(e(d) for d in t['decisions'])}"
                f"{''.join('<br><span class=fl>⚑ ' + e(f) + '</span>' for f in t['flags'])}</div></div>")
        meta = f"{s.get('size', '')} · {s.get('kind', '')} {s.get('grid', '')} · {s['exported']} exported"
        flags = "".join(f"<div class=fl>⚑ {e(f)}</div>" for f in s["flags"])
        flags += "".join(f"<div class=meta>{e(n)}</div>" for n in s.get("notes", []))
        body.append(f"<section><h3>{e(s['pack'])}</h3><div class=meta>{e(s['file'])} · {e(meta)}</div>{flags}"
                    f"<div class=row><img class=ov loading=lazy src='debug/grid_overlays/{e(s['pack'])}.jpg'>"
                    f"<div class=grid>{''.join(cards)}</div></div></section>")
    sk = "".join(f"<li>{e(s['file'])} - {e(s['reason'])}</li>" for s in skipped)
    return f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sticker batch report</title><style>
:root{{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--card:#fff;--line:#e7e5e4}}
@media (prefers-color-scheme:dark){{:root{{--bg:#1c1917;--fg:#f5f5f4;--mut:#a8a29e;--card:#292524;--line:#44403c}}}}
body{{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:1200px;margin:auto}}
h1{{margin:0 0 4px}} .meta,.d{{color:var(--mut);font-size:12px}} table{{border-collapse:collapse;margin:12px 0}}
td{{padding:3px 12px 3px 0;border-bottom:1px solid var(--line)}} .n{{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}}
section{{border-top:1px solid var(--line);padding:16px 0}} .row{{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}}
.ov{{width:300px;max-width:100%;border:1px solid var(--line);border-radius:6px}} .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;flex:1;min-width:260px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}} .card img{{width:100%;aspect-ratio:1;object-fit:contain;
background:repeating-conic-gradient(#8881 0 25%,transparent 0 50%) 0 0/16px 16px;border-radius:4px}} .ph{{aspect-ratio:1;display:grid;place-items:center;color:var(--mut)}}
.nm{{font-weight:600;margin:4px 0 2px;font-size:12px}} .b{{font-size:10px;padding:1px 6px;border-radius:9px;font-weight:600}}
.ok{{background:#dcfce7;color:#166534}} .dup{{background:#e0e7ff;color:#3730a3}} .bad{{background:#fee2e2;color:#991b1b}} .fl{{color:#c2410c}}
</style></head><body><h1>Sticker batch report</h1>
<div class=meta>{_dt.datetime.now():%Y-%m-%d %H:%M} · upscaler: {e(up)} · background mode: {e(args.bg)} · margin {args.margin}px</div>
<table>{rows}</table>
<h2>Needs a human look ({len(review) + len(review_src)})</h2><ul>{rev or '<li>Nothing flagged.</li>'}</ul>
{f'<h2>Skipped files</h2><ul>{sk}</ul>' if sk else ''}
<h2>Every source image</h2>{''.join(body)}</body></html>"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Batch-turn images / sticker screenshots into WhatsApp stickers.")
    ap.add_argument("input", help="folder, .zip, single image, or public Google Drive folder link")
    ap.add_argument("-o", "--output", help="output folder (default: ./output/stickers-<timestamp>)")
    ap.add_argument("--upscaler", choices=["auto", "realesrgan", "lanczos"], default="auto",
                    help="auto = Real-ESRGAN if installed, else Lanczos (default)")
    ap.add_argument("--bg", choices=["auto", "rembg", "none"], default="auto",
                    help="auto: key out flat tile backgrounds, keep photo backgrounds; "
                         "rembg: also AI-cut-out full-frame photos; none: keep every background")
    ap.add_argument("--photo-ai", type=float, default=0.5, metavar="0..1",
                    help="how much of the AI upscale to use for photo stickers, rest is plain Lanczos "
                         "(default 0.5; cartoons always use 1.0)")
    ap.add_argument("--margin", type=int, default=16, help="transparent margin inside 512x512 (default 16)")
    ap.add_argument("--no-pad", action="store_true", help="don't pad to a 512x512 square (longest side 512)")
    ap.add_argument("--no-webp", action="store_true", help="skip the WhatsApp .webp copies")
    ap.add_argument("--keep-duplicates", action="store_true", help="export repeated stickers instead of setting them aside")
    ap.add_argument("--keep-work", action="store_true", help="keep intermediate crops/upscales in _work/")
    args = ap.parse_args(argv)
    try:
        return run(args)
    except KeyboardInterrupt:
        print("\nInterrupted - partial output left in place; originals untouched.", file=sys.stderr)
        return 130
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
