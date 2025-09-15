#!/usr/bin/env bash
set -euo pipefail

# Create a macOS-style squircle-masked PNG from a square source image using ImageMagick.
# Default mask uses a superellipse ("squircle") for smooth corners.
# Optionally applies a subtle inner shadow to add depth (Big Sur style). Disabled by default.
# Usage:
#   bash scripts/make-squircle.sh [input_png] [output_png] [size]
# Defaults:
#   input_png  = electron/logo.png
#   output_png = electron/logo-squircle.png
#   size       = 1024 (final square size)
# Env:
#   SQUIRCLE_EXP=5       # superellipse exponent (default: 5)
#   SQUIRCLE_AA=         # optional mask edge blur sigma (e.g., 0.5)
#   SQUIRCLE_INNER=1     # enable inner shadow if set to 1 (default: disabled)
#   SQUIRCLE_INSET=    # override inner shadow inset (px), default ~6% of size
#   SQUIRCLE_ALPHA=    # override inner shadow opacity (0-100), default 22

INPUT_PNG="${1:-electron/logo.png}"
OUTPUT_PNG="${2:-electron/logo-squircle.png}"
SIZE="${3:-1024}"

# Find ImageMagick
IM=""
if command -v magick >/dev/null 2>&1; then IM="magick"; fi
if [[ -z "$IM" ]] && command -v convert >/dev/null 2>&1; then IM="convert"; fi
if [[ -z "$IM" ]]; then
  echo "[make-squircle] ImageMagick not found. Install with: brew install imagemagick" >&2
  exit 1
fi

if [[ ! -f "$INPUT_PNG" ]]; then
  echo "[make-squircle] Input PNG not found: $INPUT_PNG" >&2
  exit 1
fi

# Prepare square canvas at desired size with transparent background, centered
TMP_INPUT="$(mktemp -t squircle_in_XXXX).png"
TMP_MASK="$(mktemp -t squircle_mask_XXXX).png"
TMP_RING="$(mktemp -t squircle_ring_XXXX).png"
trap 'rm -f "$TMP_INPUT" "$TMP_MASK" "$TMP_RING"' EXIT

# Resize to fit within SIZE x SIZE, keep aspect, center on transparent extent
$IM "$INPUT_PNG" -resize ${SIZE}x${SIZE} -background none -gravity center -extent ${SIZE}x${SIZE} "$TMP_INPUT"

SIZE_INT=$SIZE

# Build superellipse (squircle) mask and apply as alpha
N=${SQUIRCLE_EXP:-5}
$IM -size ${SIZE}x${SIZE} xc:none -channel A \
  -fx "(pow(abs((2*i/(w-1))-1),$N)+pow(abs((2*j/(h-1))-1),$N) <= 1) ? 1 : 0" \
  +channel "$TMP_MASK"

AA=${SQUIRCLE_AA:-}
if [[ -n "$AA" ]]; then
  $IM "$TMP_MASK" -gaussian-blur 0x"$AA" "$TMP_MASK"
fi

$IM "$TMP_INPUT" -alpha set "$TMP_MASK" -compose DstIn -composite "$OUTPUT_PNG"

# Optional subtle inner shadow to add perceived depth
INNER=${SQUIRCLE_INNER:-0}
if [[ "$INNER" != "0" ]]; then
  INSET=${SQUIRCLE_INSET:-}
  if [[ -z "${INSET}" ]]; then
    # Default ~6% of size: (SIZE * 60 + 500)/1000
    INSET=$(( (SIZE_INT*60 + 500)/1000 ))
  fi
  ALPHA=${SQUIRCLE_ALPHA:-22}
  # Build a blurred superellipse ring by shrinking the mask and subtracting
  TMP_OUTERA="$(mktemp -t squircle_outerA_XXXX).png"; TMP_INNERA="$(mktemp -t squircle_innerA_XXXX).png"
  trap 'rm -f "$TMP_INPUT" "$TMP_MASK" "$TMP_RING" "$TMP_OUTERA" "$TMP_INNERA"' EXIT
  # Extract alpha of the outer mask
  $IM "$TMP_MASK" -alpha extract "$TMP_OUTERA"
  # Create inner alpha by scaling down and re-centering
  SCALE=$(( SIZE_INT - 2*INSET ))
  $IM "$TMP_OUTERA" -resize ${SCALE}x${SCALE} -background black -gravity center -extent ${SIZE}x${SIZE} "$TMP_INNERA"
  # Subtract inner from outer to get a ring
  $IM "$TMP_OUTERA" "$TMP_INNERA" -compose minus_src -composite "$TMP_RING"
  # Blur the ring for softness
  $IM "$TMP_RING" -gaussian-blur 0x6 "$TMP_RING"

  # Make it subtle and overlay (no additional clipping to avoid shape changes)
  $IM "$TMP_RING" -alpha on -channel A -evaluate set ${ALPHA}% +channel "$TMP_RING"
  # Overlay ring onto masked image
  $IM "$OUTPUT_PNG" "$TMP_RING" -compose Over -composite "$OUTPUT_PNG"
fi

echo "[make-squircle] Wrote: $OUTPUT_PNG"
