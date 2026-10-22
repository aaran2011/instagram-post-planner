#!/usr/bin/env bash
# One-time setup: Python packages + the Real-ESRGAN AI upscaler (local, offline after download).
#   ./setup.sh              core packages + Real-ESRGAN (~45 MB)
#   ./setup.sh --with-rembg also the optional AI background cut-out for photos (~180 MB model)
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}
echo "==> Python: $($PY --version)"
$PY -m pip install --user -q -r requirements.txt
echo "    core packages installed"

if [[ "${1:-}" == "--with-rembg" ]]; then
  $PY -m pip install --user -q "rembg>=2.0.50" onnxruntime
  $PY -c "from rembg import new_session; new_session('isnet-general-use')" && echo "    rembg + isnet model ready"
fi

case "$(uname -s)" in
  Darwin) ZIP=realesrgan-ncnn-vulkan-20220424-macos.zip ;;
  Linux)  ZIP=realesrgan-ncnn-vulkan-20220424-ubuntu.zip ;;
  *)      ZIP=realesrgan-ncnn-vulkan-20220424-windows.zip ;;
esac
URL="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/$ZIP"
mkdir -p tools
if ! find tools -name 'realesrgan-ncnn-vulkan*' -type f | grep -q .; then
  echo "==> Downloading Real-ESRGAN ($ZIP)"
  for i in 1 2 3 4 5 6; do
    curl -fL -C - --retry 5 -o "tools/$ZIP" "$URL" && break
    echo "    connection dropped, resuming ($i)"; sleep 3
  done
  unzip -o -q "tools/$ZIP" -d tools/realesrgan
  rm -f "tools/$ZIP"
fi
BIN=$(find tools -name 'realesrgan-ncnn-vulkan' -type f -o -name 'realesrgan-ncnn-vulkan.exe' -type f | head -1)
chmod +x "$BIN" 2>/dev/null || true
[[ "$(uname -s)" == "Darwin" ]] && xattr -dr com.apple.quarantine tools 2>/dev/null || true
echo "==> Real-ESRGAN: $BIN"
echo "Done. Run:  $PY sticker_pipeline.py <folder | file.zip | drive-folder-link>"
