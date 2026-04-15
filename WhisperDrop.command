#!/bin/bash
# Double-click this to launch the WhisperDrop app

set -e

cd "$(dirname "$0")"

VENV_PYTHON="$PWD/.venv/bin/python"
NEEDS_SETUP=0

find_whisper_cpp() {
  if command -v whisper-cli >/dev/null 2>&1; then
    command -v whisper-cli
    return 0
  fi

  if command -v whisper-cpp >/dev/null 2>&1; then
    command -v whisper-cpp
    return 0
  fi

  if [ -x /opt/homebrew/bin/whisper-cli ]; then
    echo /opt/homebrew/bin/whisper-cli
    return 0
  fi

  if [ -x /usr/local/bin/whisper-cli ]; then
    echo /usr/local/bin/whisper-cli
    return 0
  fi

  if [ -x /opt/homebrew/bin/whisper-cpp ]; then
    echo /opt/homebrew/bin/whisper-cpp
    return 0
  fi

  if [ -x /usr/local/bin/whisper-cpp ]; then
    echo /usr/local/bin/whisper-cpp
    return 0
  fi

  return 1
}

find_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1; then
    command -v ffmpeg
    return 0
  fi

  if [ -x /opt/homebrew/bin/ffmpeg ]; then
    echo /opt/homebrew/bin/ffmpeg
    return 0
  fi

  if [ -x /usr/local/bin/ffmpeg ]; then
    echo /usr/local/bin/ffmpeg
    return 0
  fi

  return 1
}

pause_on_error() {
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  echo ""
}

if [ ! -x "$VENV_PYTHON" ]; then
  NEEDS_SETUP=1
fi

if [ "$NEEDS_SETUP" -eq 0 ] && [ -z "$(find_ffmpeg || true)" ]; then
  NEEDS_SETUP=1
fi

if [ "$NEEDS_SETUP" -eq 0 ] && [ -z "$(find_whisper_cpp || true)" ]; then
  NEEDS_SETUP=1
fi

if [ "$NEEDS_SETUP" -eq 0 ] && ! "$VENV_PYTHON" -c "import tkinter" >/dev/null 2>&1; then
  NEEDS_SETUP=1
fi

if [ "$NEEDS_SETUP" -eq 1 ]; then
  echo "First launch detected. Running setup..."
  echo ""
  if ! bash "$PWD/scripts/setup.sh"; then
    echo ""
    echo "Setup failed. Please review the messages above."
    pause_on_error
    exit 1
  fi
  echo ""
fi

if [ ! -x "$VENV_PYTHON" ]; then
  echo "The local environment was not created correctly."
  pause_on_error
  exit 1
fi

exec "$VENV_PYTHON" "$PWD/transcriber.py"
