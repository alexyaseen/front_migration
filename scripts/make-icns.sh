#!/usr/bin/env bash
set -euo pipefail

# Generate a macOS .icns from a square PNG using sips + iconutil.
# Usage:
#   bash scripts/make-icns.sh [input_png] [output_icns]
# Defaults:
#   input_png  = electron/logo.png
#   output_icns = electron/icon.icns

INPUT_PNG="${1:-electron/logo.png}"
OUTPUT_ICNS="${2:-electron/icon.icns}"
ICONSET_DIR="$(dirname "$OUTPUT_ICNS")/icon.iconset"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[make-icns] This script requires macOS (sips/iconutil)." >&2
  exit 1
fi

command -v sips >/dev/null 2>&1 || { echo "[make-icns] 'sips' not found (install Xcode command line tools)." >&2; exit 1; }
command -v iconutil >/dev/null 2>&1 || { echo "[make-icns] 'iconutil' not found (install Xcode)." >&2; exit 1; }

if [[ ! -f "$INPUT_PNG" ]]; then
  echo "[make-icns] Input PNG not found: $INPUT_PNG" >&2
  exit 1
fi

mkdir -p "$ICONSET_DIR"

echo "[make-icns] Building iconset from $INPUT_PNG"
sips -z 16 16     "$INPUT_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32     "$INPUT_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$INPUT_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64     "$INPUT_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$INPUT_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256   "$INPUT_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$INPUT_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512   "$INPUT_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$INPUT_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
cp "$INPUT_PNG" "$ICONSET_DIR/icon_512x512@2x.png"  # 1024x1024

mkdir -p "$(dirname "$OUTPUT_ICNS")"
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"

echo "[make-icns] Wrote: $OUTPUT_ICNS"
echo "[make-icns] Tip: electron-builder will use this for macOS packaging."

