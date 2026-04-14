#!/bin/bash
# WhisperDrop - Setup Script
# Prepares a local virtual environment and installs the required tools.

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$APP_DIR/.venv"
REQ_FILE="$APP_DIR/requirements.txt"

echo ""
echo "======================================"
echo "  WhisperDrop - Setup"
echo "======================================"
echo ""

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    echo /opt/homebrew/bin/brew
    return 0
  fi

  if [ -x /usr/local/bin/brew ]; then
    echo /usr/local/bin/brew
    return 0
  fi

  return 1
}

install_homebrew() {
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

BREW_BIN="$(find_brew || true)"
if [ -z "$BREW_BIN" ]; then
  install_homebrew
  BREW_BIN="$(find_brew)"
fi

echo "Using Homebrew at:"
echo "  $BREW_BIN"

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

FFMPEG_BIN="$(find_ffmpeg || true)"
if [ -z "$FFMPEG_BIN" ]; then
  echo "Installing ffmpeg..."
  "$BREW_BIN" install ffmpeg
  FFMPEG_BIN="$(find_ffmpeg || true)"
else
  echo "ffmpeg already installed"
fi

if [ -z "$FFMPEG_BIN" ]; then
  echo "ffmpeg was not found after installation."
  exit 1
fi

echo "Using ffmpeg:"
echo "  $FFMPEG_BIN"

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

WHISPER_CPP_BIN="$(find_whisper_cpp || true)"
if [ -z "$WHISPER_CPP_BIN" ]; then
  echo "Installing whisper.cpp..."
  "$BREW_BIN" install whisper-cpp
  WHISPER_CPP_BIN="$(find_whisper_cpp || true)"
fi

if [ -z "$WHISPER_CPP_BIN" ]; then
  echo "whisper.cpp was not found after installation."
  exit 1
fi

echo "Using whisper.cpp:"
echo "  $WHISPER_CPP_BIN"

PYTHON_BIN=""
if command -v python3.11 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.11)"
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "Installing Python 3.11..."
  "$BREW_BIN" install python@3.11
  BREW_PREFIX="$("$BREW_BIN" --prefix)"
  if [ -x "$BREW_PREFIX/bin/python3.11" ]; then
    PYTHON_BIN="$BREW_PREFIX/bin/python3.11"
  fi
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3.11 was not found after installation."
  exit 1
fi

echo "Using Python:"
echo "  $PYTHON_BIN"

venv_is_healthy() {
  if [ ! -x "$VENV_DIR/bin/python" ]; then
    return 1
  fi

  if ! "$VENV_DIR/bin/python" -c "import sys; print(sys.prefix)" >/dev/null 2>&1; then
    return 1
  fi

  if ! "$VENV_DIR/bin/python" -m pip --version >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating local virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
else
  if venv_is_healthy; then
    echo "Local virtual environment already exists"
  else
    echo "Existing virtual environment is outdated or was moved. Recreating it..."
    rm -rf "$VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  fi
fi

echo "Upgrading pip..."
"$VENV_DIR/bin/python" -m pip install --upgrade pip

echo "Installing Python packages..."
"$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE"

echo "Running installation checks..."
if ! "$WHISPER_CPP_BIN" --version >/dev/null 2>&1; then
  echo "whisper.cpp is installed but did not respond correctly."
  exit 1
fi
"$VENV_DIR/bin/python" - <<'PY'
import tkinter
import tkinterdnd2

print("tkinter OK")
print("tkinterdnd2 OK")
PY

echo ""
echo "======================================"
echo "  Setup complete"
echo "======================================"
echo ""
echo "To open the app:"
echo "  double-click 'WhisperDrop.command'"
echo ""
echo "If you prefer the terminal:"
echo "  $APP_DIR/.venv/bin/python $APP_DIR/transcriber.py"
echo ""