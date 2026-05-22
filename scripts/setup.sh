#!/bin/bash
# WhisperDrop - Setup Script
# Prepares a local virtual environment and installs the required tools.

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${WHISPERDROP_RUNTIME_DIR:-$APP_DIR}"
VENV_DIR="$RUNTIME_DIR/.venv"
REQ_FILE="$APP_DIR/requirements.txt"
TOOLS_DIR="$RUNTIME_DIR/.tools"
WHISPER_REPO_DIR="$TOOLS_DIR/whisper.cpp"
FFMPEG_DIR="$TOOLS_DIR/ffmpeg"

mkdir -p "$RUNTIME_DIR"

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

  return 1
}

install_homebrew() {
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

BREW_BIN="$(find_brew || true)"
if [ -z "$BREW_BIN" ]; then
  install_homebrew
  bootstrap_path
  BREW_BIN="$(find_brew)"
fi

echo "Using Homebrew at:"
echo "  $BREW_BIN"

find_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1; then
    command -v ffmpeg
    return 0
  fi

  resolve_brew_bin ffmpeg ffmpeg && return 0

  local bundled="$FFMPEG_DIR/bin/ffmpeg"
  if [ -x "$bundled" ]; then
    echo "$bundled"
    return 0
  fi

  return 1
}

ensure_brew_formula() {
  local formula="$1"
  local label="$2"

  if command -v "$formula" >/dev/null 2>&1 || brew list "$formula" >/dev/null 2>&1; then
    return 0
  fi

  echo "Installing $label..."
  "$BREW_BIN" install "$formula"
}

download_bundled_ffmpeg() {
  local arch=""
  local download_url=""
  local temp_dir=""
  local temp_file=""

  arch="$(uname -m)"
  mkdir -p "$FFMPEG_DIR/bin"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/whisper-drop-ffmpeg.XXXXXX")"
  temp_file="$temp_dir/ffmpeg-download"

  echo "Downloading ffmpeg..."
  if [ "$arch" = "arm64" ]; then
    download_url="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64"
    curl -fsSL "$download_url" -o "$temp_file"
    chmod +x "$temp_file"
    mv "$temp_file" "$FFMPEG_DIR/bin/ffmpeg"
  else
    download_url="https://evermeet.cx/ffmpeg/getrelease/zip"
    curl -fsSL "$download_url" -o "$temp_dir/ffmpeg.zip"
    unzip -q "$temp_dir/ffmpeg.zip" -d "$temp_dir/extracted"
    install -m 755 "$temp_dir/extracted/ffmpeg" "$FFMPEG_DIR/bin/ffmpeg"
  fi

  rm -rf "$temp_dir"

  if [ ! -x "$FFMPEG_DIR/bin/ffmpeg" ]; then
    echo "ffmpeg was not found after download."
    exit 1
  fi

  echo "Using bundled ffmpeg:"
  echo "  $FFMPEG_DIR/bin/ffmpeg"
}

ensure_ffmpeg() {
  local existing=""

  existing="$(find_ffmpeg || true)"
  if [ -n "$existing" ]; then
    echo "Using ffmpeg:"
    echo "  $existing"
    return 0
  fi

  download_bundled_ffmpeg
}

get_local_whisper_binary() {
  local candidate=""
  local binary_candidates=(
    "$WHISPER_REPO_DIR/build/bin/whisper-cli"
    "$WHISPER_REPO_DIR/build/bin/whisper-cpp"
    "$WHISPER_REPO_DIR/build/bin/Release/whisper-cli"
    "$WHISPER_REPO_DIR/build/bin/Release/whisper-cpp"
  )

  for candidate in "${binary_candidates[@]}"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

find_whisper_cpp() {
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
  get_local_whisper_binary && return 0

  return 1
}

invoke_whisper_cpp_build() {
  local enable_metal="$1"
  local build_flavor=""
  local build_root=""
  local repo_build_dir=""
  local repo_bin_dir=""
  local built_bin_dir=""
  local cmake_bin=""
  local cpu_count=""

  cmake_bin="$(command -v cmake)"
  build_flavor="metal"
  if [ "$enable_metal" -eq 0 ]; then
    build_flavor="cpu"
  fi

  build_root="$(mktemp -d "${TMPDIR:-/tmp}/whisper-drop-build-${build_flavor}.XXXXXX")"
  repo_build_dir="$WHISPER_REPO_DIR/build"
  repo_bin_dir="$repo_build_dir/bin"
  cpu_count="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"

  if [ -d "$repo_build_dir" ]; then
    rm -rf "$repo_build_dir"
  fi

  build_mode_label="Metal support"
  if [ "$enable_metal" -eq 0 ]; then
    build_mode_label="CPU-only mode"
  fi

  echo "Building whisper.cpp with $build_mode_label..."

  configure_args=(
    -S "$WHISPER_REPO_DIR"
    -B "$build_root"
    -DCMAKE_BUILD_TYPE=Release
    -Wno-dev
  )

  if [ "$enable_metal" -eq 1 ]; then
    configure_args+=(-DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON)
  else
    configure_args+=(-DGGML_METAL=OFF)
  fi

  if ! "$cmake_bin" "${configure_args[@]}"; then
    rm -rf "$build_root"
    return 1
  fi

  if ! "$cmake_bin" --build "$build_root" --config Release -j "$cpu_count"; then
    rm -rf "$build_root"
    return 1
  fi

  built_bin_dir="$build_root/bin"
  if [ ! -d "$built_bin_dir" ]; then
    rm -rf "$build_root"
    return 1
  fi

  mkdir -p "$repo_bin_dir"
  cp -R "$built_bin_dir/." "$repo_bin_dir/"
  rm -rf "$build_root"
  return 0
}

ensure_whisper_cpp() {
  local existing=""
  local local_build=""
  local git_bin=""
  local built_with_metal=0
  local has_source_checkout=0

  existing="$(find_whisper_cpp || true)"
  if [ -n "$existing" ]; then
    echo "Using whisper.cpp:"
    echo "  $existing"
    return 0
  fi

  ensure_brew_formula git Git
  ensure_brew_formula cmake CMake
  git_bin="$(command -v git)"

  if [ -f "$WHISPER_REPO_DIR/CMakeLists.txt" ] && [ -d "$WHISPER_REPO_DIR/.git" ]; then
    has_source_checkout=1
  fi

  if [ -d "$WHISPER_REPO_DIR" ] && [ "$has_source_checkout" -eq 0 ]; then
    echo "Replacing existing whisper.cpp binaries with a source checkout for Metal build..."
    rm -rf "$WHISPER_REPO_DIR"
  fi

  if [ ! -d "$WHISPER_REPO_DIR" ]; then
    mkdir -p "$TOOLS_DIR"
    echo "Cloning whisper.cpp..."
    "$git_bin" clone https://github.com/ggml-org/whisper.cpp.git "$WHISPER_REPO_DIR"
  else
    echo "Updating local whisper.cpp checkout..."
    "$git_bin" -C "$WHISPER_REPO_DIR" fetch --tags --prune
    "$git_bin" -C "$WHISPER_REPO_DIR" pull --ff-only
  fi

  if invoke_whisper_cpp_build 1; then
    built_with_metal=1
  else
    echo "Metal build failed. Falling back to CPU-only whisper.cpp build."
    if ! invoke_whisper_cpp_build 0; then
      echo "whisper.cpp build failed."
      exit 1
    fi
  fi

  local_build="$(get_local_whisper_binary || true)"
  if [ -z "$local_build" ]; then
    echo "whisper.cpp build completed without producing a usable whisper executable."
    exit 1
  fi

  if [ "$built_with_metal" -eq 1 ]; then
    echo "Using local whisper.cpp Metal build:"
  else
    echo "Using local whisper.cpp CPU build:"
  fi
  echo "  $local_build"
}

ensure_ffmpeg
ensure_whisper_cpp
WHISPER_CPP_BIN="$(find_whisper_cpp || true)"

PYTHON_BIN=""
if command -v python3.11 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.11)"
fi

if [ -z "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(resolve_brew_bin python@3.11 python3.11 || true)"
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "Installing Python 3.11..."
  "$BREW_BIN" install python@3.11
  bootstrap_path
  PYTHON_BIN="$(resolve_brew_bin python@3.11 python3.11 || true)"
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

if ! "$VENV_DIR/bin/yt-dlp" --version >/dev/null 2>&1; then
  echo "yt-dlp is installed but did not respond correctly."
  exit 1
fi

echo ""
echo "======================================"
echo "  Setup complete"
echo "======================================"
echo ""
echo "To open the app:"
echo "  double-click 'WhisperDrop.app' or 'WhisperDrop.command'"
echo ""
echo "If you prefer the terminal:"
echo "  WHISPERDROP_RUNTIME_DIR=\"$RUNTIME_DIR\" \"$VENV_DIR/bin/python\" \"$APP_DIR/transcriber.py\""
echo ""
