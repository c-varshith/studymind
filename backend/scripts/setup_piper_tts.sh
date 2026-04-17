#!/usr/bin/env bash
set -euo pipefail

# Downloads a high-quality English Piper voice model locally.
# Default voice: en_US-amy-medium

VOICE="${1:-en_US-amy-medium}"
OUT_DIR="${2:-./models/piper}"

case "$VOICE" in
  en_US-amy-medium)
    MODEL_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx"
    CONFIG_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"
    ;;
  en_US-ryan-high)
    MODEL_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx"
    CONFIG_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json"
    ;;
  *)
    echo "Unsupported voice preset: $VOICE"
    echo "Supported presets: en_US-amy-medium, en_US-ryan-high"
    exit 1
    ;;
esac

mkdir -p "$OUT_DIR"

echo "Downloading Piper model: $VOICE"
curl -L "$MODEL_URL" -o "$OUT_DIR/$VOICE.onnx"
curl -L "$CONFIG_URL" -o "$OUT_DIR/$VOICE.onnx.json"

echo "Downloaded:"
echo "  $OUT_DIR/$VOICE.onnx"
echo "  $OUT_DIR/$VOICE.onnx.json"

echo
echo "Next steps:"
echo "1) Install Piper binary if missing:"
echo "   - Fedora: sudo dnf install piper"
echo "   - Ubuntu/Debian: install piper package or use official release binary"
echo "2) Set backend/.env values:"
echo "   TTS_PIPER_BIN=piper"
echo "   TTS_MODEL_PATH=$(pwd)/$OUT_DIR/$VOICE.onnx"
echo "   TTS_CONFIG_PATH=$(pwd)/$OUT_DIR/$VOICE.onnx.json"
echo "3) Restart backend: uvicorn main:app --reload --port 8000"
