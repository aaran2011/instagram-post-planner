import path from "path";
import fs from "fs";

// All persistent state lives under ./data (gitignored).
export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const THUMB_DIR = path.join(DATA_DIR, "thumbs");
export const DB_FILE = path.join(DATA_DIR, "db.json");

export function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR, THUMB_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function uploadPath(file: string) {
  return path.join(UPLOAD_DIR, path.basename(file));
}

export function thumbPath(file: string) {
  return path.join(THUMB_DIR, path.basename(file));
}
