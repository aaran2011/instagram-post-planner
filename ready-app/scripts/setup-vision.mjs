/**
 * Puts the on-device pose model and its WebAssembly runtime under /public.
 *
 * Both are served from this origin rather than a CDN so that:
 *   - framing/posture analysis runs with no third party seeing the camera,
 *   - the checks keep working on a hotel wifi that blocks half the internet,
 *   - the Content-Security-Policy can stay tight.
 *
 * Runs on `npm install`. Safe to re-run; existing files are left alone.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const ROOT = process.cwd();
const WASM_SRC = path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DEST = path.join(ROOT, 'public/mediapipe/wasm');
const MODEL_DEST = path.join(ROOT, 'public/models/pose_landmarker_lite.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const exists = (p) => stat(p).then(() => true, () => false);

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    console.warn('[vision] @mediapipe/tasks-vision not installed yet — skipping wasm copy.');
    return;
  }
  await mkdir(WASM_DEST, { recursive: true });
  const files = (await readdir(WASM_SRC)).filter((f) => !f.includes('module_internal'));
  for (const file of files) {
    const dest = path.join(WASM_DEST, file);
    if (await exists(dest)) continue;
    await copyFile(path.join(WASM_SRC, file), dest);
  }
  console.log(`[vision] wasm runtime ready (${files.length} files).`);
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    console.log('[vision] pose model already present.');
    return;
  }
  await mkdir(path.dirname(MODEL_DEST), { recursive: true });
  try {
    const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(MODEL_DEST));
    console.log('[vision] pose_landmarker_lite.task downloaded.');
  } catch (err) {
    // Not fatal: the app detects the missing model and says framing guidance is
    // unavailable rather than pretending it measured anything.
    console.warn(`[vision] could not download the pose model (${err.message}).`);
    console.warn('[vision] Live framing guidance stays unavailable until you run: npm run setup:vision');
  }
}

await copyWasm();
await fetchModel();
