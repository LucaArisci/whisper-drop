#!/bin/bash
# Double-click this to launch the WhisperDrop app

set -e

cd "$(dirname "$0")"

APP_DIR="${WHISPERDROP_APP_DIR:-$PWD}"
RUNTIME_DIR="${WHISPERDROP_RUNTIME_DIR:-$APP_DIR}"
VENV_PYTHON="$RUNTIME_DIR/.venv/bin/python"
NEEDS_SETUP=0

mkdir -p "$RUNTIME_DIR"
export WHISPERDROP_APP_DIR="$APP_DIR"
export WHISPERDROP_RUNTIME_DIR="$RUNTIME_DIR"

bootstrap_path() {
  local login_shell=""
  local login_path=""

  if [ -x /usr/libexec/path_helper ]; then
    eval "$(/usr/libexec/path_helper -s)"
  fi

  if [ -n "${SHELL:-}" ] && [ -x "${SHELL:-}" ]; then
    login_shell="$SHELL"
  elif command -v zsh >/dev/null 2>&1; then
    login_shell="$(command -v zsh)"
  elif command -v bash >/dev/null 2>&1; then
    login_shell="$(command -v bash)"
  fi

  if [ -n "$login_shell" ]; then
    login_path="$("$login_shell" -lc 'printf %s "$PATH"' 2>/dev/null || true)"
    if [ -n "$login_path" ]; then
      PATH="$login_path"
      export PATH
    fi
  fi
}

resolve_brew_bin() {
  local formula="$1"
  local binary="$2"
  local prefix=""

  if ! command -v brew >/dev/null 2>&1; then
    return 1
  fi

  prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
  if [ -n "$prefix" ] && [ -x "$prefix/bin/$binary" ]; then
    echo "$prefix/bin/$binary"
    return 0
  fi

  return 1
}

bootstrap_path

find_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1; then
    command -v ffmpeg
    return 0
  fi

  resolve_brew_bin ffmpeg ffmpeg && return 0

  local bundled="$RUNTIME_DIR/.tools/ffmpeg/bin/ffmpeg"
  if [ -x "$bundled" ]; then
    echo "$bundled"
    return 0
  fi

  return 1
}

find_whisper_cpp() {
  local candidate=""

  if command -v whisper-cli >/dev/null 2>&1; then
    command -v whisper-cli
    return 0
  fi

  if command -v whisper-cpp >/dev/null 2>&1; then
    command -v whisper-cpp
    return 0
  fi

  resolve_brew_bin whisper-cpp whisper-cli && return 0
  resolve_brew_bin whisper-cpp whisper-cpp && return 0

  for candidate in \
    "$RUNTIME_DIR/.tools/whisper.cpp/build/bin/whisper-cli" \
    "$RUNTIME_DIR/.tools/whisper.cpp/build/bin/whisper-cpp" \
    "$RUNTIME_DIR/.tools/whisper.cpp/build/bin/Release/whisper-cli" \
    "$RUNTIME_DIR/.tools/whisper.cpp/build/bin/Release/whisper-cpp"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

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
  if ! bash "$APP_DIR/scripts/setup.sh"; then
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

exec "$VENV_PYTHON" "$APP_DIR/transcriber.py"
