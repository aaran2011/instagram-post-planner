# WhatsApp sticker batch pipeline

Turns a pile of images — sticker-pack screenshots, contact sheets, single
stickers, photos — into ready-to-use WhatsApp stickers:
**512×512 transparent PNG** (plus a WhatsApp-size `.webp` copy under 100 KB), with
an HTML/CSV report explaining every decision. Everything runs locally; your
originals are never modified.

## 1. One-time setup (≈1 minute)

```bash
cd "whatsapp-stickers"
./setup.sh
```

This installs the Python packages (Pillow, NumPy, OpenCV, tqdm) and downloads
**Real-ESRGAN** (`realesrgan-ncnn-vulkan`, ~45 MB, from the author's official
GitHub release) into `tools/`. It runs on the GPU (Metal on Apple Silicon,
Vulkan on Windows/Linux) and needs no internet after setup.

Optional extras:

| Extra | Install | What for |
|---|---|---|
| AI background cut-out | `./setup.sh --with-rembg` | `--bg rembg`: cuts the person/animal out of full-frame **photo** stickers (downloads the 180 MB `isnet-general-use` model once) |
| iPhone HEIC input | `pip3 install --user pillow-heif` | `.heic` / `.heif` files |

If Real-ESRGAN isn't installed the pipeline still works: it falls back to
Lanczos resampling + a mild unsharp mask, and the report says so.

## 2. Provide the files — any one of these

```bash
python3 sticker_pipeline.py ~/Downloads/Stickers                 # a folder (searched recursively)
python3 sticker_pipeline.py ~/Downloads/Stickers.zip             # a ZIP (nested ZIPs are fine)
python3 sticker_pipeline.py "https://drive.google.com/drive/folders/<id>"   # public Drive folder
python3 sticker_pipeline.py photo.jpg                            # a single image
```

- **Google Drive:** the folder must be shared as *Anyone with the link*. The
  pipeline downloads every file (and subfolders, up to 3 levels) with no login.
  If that fails (private folder, Drive changes its page), open the folder in
  the browser → **Download** (Drive zips it) → pass the ZIP.
- Formats: JPG, PNG (transparency kept), WebP, GIF (first frame), BMP, TIFF, HEIC
  (with `pillow-heif`). Anything else is listed as skipped in the report.

## 3. Run

```bash
python3 sticker_pipeline.py INPUT                 # sensible defaults
python3 sticker_pipeline.py INPUT -o ~/Desktop/my-stickers
```

| Option | Default | Meaning |
|---|---|---|
| `-o DIR` | `output/stickers-<timestamp>` | where results go (must not be inside the input folder) |
| `--upscaler auto\|realesrgan\|lanczos` | `auto` | `realesrgan` fails loudly if the AI upscaler is missing |
| `--bg auto\|rembg\|none` | `auto` | `auto`: remove flat tile/card backgrounds, keep photo backgrounds. `rembg`: also AI-cut-out photos. `none`: keep every background |
| `--photo-ai 0..1` | `0.5` | share of the AI upscale used for **photo** stickers; the rest is a plain resample, which keeps real skin/fur texture. Cartoons always get the full AI result |
| `--margin N` | `16` | transparent margin inside the 512×512 canvas (WhatsApp recommends ~16 px) |
| `--no-pad` | off | longest side 512 instead of a padded 512×512 square |
| `--no-webp` | off | skip the `.webp` copies |
| `--keep-duplicates` | off | export repeats instead of setting them aside |
| `--keep-work` | off | keep intermediate crops/upscales for debugging |

Progress bars show each stage; a summary prints at the end. Errors on one image
are logged and the batch carries on.

Speed: on an M1, AI upscaling is ~2–3 s per sticker on the GPU (a 375-sticker
batch takes ~15–20 min); everything else takes about a minute. Upscales are
cached in `.cache/` by image content, so re-running the same inputs (e.g. with
different `--margin` or `--bg`) skips the GPU step.

## 4. Download the result

The last lines of the run print two paths:

```
Folder: …/output/stickers-20261022-141500
ZIP:    …/output/stickers-20261022-141500.zip
```

The **ZIP** is the single downloadable package; on a Mac, `open output/` shows
it in Finder. It contains:

```
stickers/<pack>/<pack>_r1c2.png   512×512 transparent PNGs, one folder per source image
whatsapp_webp/<pack>/…webp        same stickers as WebP ≤100 KB (what WhatsApp packs use)
duplicates/                       repeats found across overlapping screenshots (best copy kept in stickers/)
review/                           everything flagged: cut-off tiles, ambiguous layouts, "check" copies
debug/grid_overlays/              each source image with detected tiles drawn on it
originals/                        untouched copies of every input
report.html                       visual report (open in a browser)
report.csv / report.json          one row per tile with every decision
summary.txt  run.log
```

Naming: `003_wa_2026-10-22_12-56-26_r2c1.png` = 3rd source image (a WhatsApp
screenshot from 22 Oct 2026 12:56:26), row 2, column 1 of its grid. Single
images get just the pack name.

To put them on WhatsApp: use a sticker-maker app (e.g. *Sticker Maker* on
iOS/Android), create a pack and import the PNGs or WebPs — a pack needs 3–30
stickers plus a 96×96 tray icon.

## How decisions are made

**Grid vs single.** Each image is cut along fully blank rows/columns (recursive
XY-cut against the page colour, after removing thin divider lines). The pieces
count as a grid when they look like sticker tiles (a uniform tile background
different from the page) or form a regular grid of equal-sized cells. Otherwise
the image is **kept whole and flagged** — a "collage" is never guessed apart.
One region ⇒ single image, never split.

**Edge tiles.** A tile under 80% of the typical tile size touching the image
edge is a *partial* (cut off by the screenshot): not exported, saved in
`review/`. Thin slivers under 12 px are ignored and counted. Tiles that are
oversized (maybe two pictures with no gutter) are also held back for review.

**Background.** The tile colour is sampled from the tile rim and flood-filled
inward from the edges only, so outlines stop it and white or pale subjects
(e.g. a white bear on a pale grey tile) survive. Large pockets of the exact
tile colour enclosed by the subject are also cleared. Edges get soft alpha
and the tile tint is removed from edge pixels (no grey halo). Existing
transparency in PNG/WebP input is kept as-is. Stickers that are full-frame
photos keep their background unless you pass `--bg rembg`.

**Upscaling.** If the subject is smaller than the 480 px it needs (512 minus
margins), or is blurry, it goes through Real-ESRGAN ×4 — the *anime* model for
flat cartoon art, the *x4plus* model for photos (chosen per sticker) — then is
scaled down to exactly fit. For photos the AI result is blended 50/50 with a
plain resample (`--photo-ai`), because Real-ESRGAN tends to repaint low-res
fur and skin as smooth brush strokes. Which pixels are background is decided at
the original resolution (upscalers can blend a white subject into a near-white
tile); the upscaled image is then used only to sharpen the cut-out edge. Sources needing more
than ×6 are flagged as very low resolution.

**Duplicates.** Overlapping screenshots repeat stickers. Candidates are found
with a perceptual hash, then confirmed by matching outlines at the source
resolution (robust to different screenshot zoom). The highest-resolution copy
stays in `stickers/`; others go to `duplicates/`. Near-matches that aren't
certain keep both and are flagged.

**Nothing is destructive.** Inputs are only read; copies go to `originals/`.
Every skipped, partial, duplicate or doubtful item is kept somewhere in the
output and listed in the report.

## Tuning

Constants near the top of the relevant functions in `sticker_pipeline.py`:
`DUP_EDGE_MATCH` / `DUP_MAYBE` (duplicate strictness), the 0.8 / 1.6 tile-size
ratios in `detect_layout`, the blur threshold `60` in `prepare_tile`.
