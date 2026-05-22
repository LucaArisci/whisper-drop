#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="WhisperDrop"
BUNDLE_ID="com.whisperdrop.app"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/dist/$APP_NAME.app"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$APP_NAME"
APP_SOURCE="$APP_BUNDLE/Contents/Resources/app"
RUNTIME_DIR="${WHISPERDROP_RUNTIME_DIR:-$ROOT_DIR}"

kill_running_app() {
  pkill -f "$APP_SOURCE/transcriber.py" >/dev/null 2>&1 || true
  pkill -f "$APP_EXECUTABLE" >/dev/null 2>&1 || true
}

build_app() {
  "$ROOT_DIR/scripts/build_macos_app.sh" >/dev/null
}

open_app() {
  nohup env WHISPERDROP_RUNTIME_DIR="$RUNTIME_DIR" "$APP_EXECUTABLE" >/tmp/whisperdrop-launch.log 2>&1 &
}

verify_app() {
  sleep 3
  pgrep -f "$APP_SOURCE/transcriber.py" >/dev/null
}

usage() {
  echo "usage: $0 [run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify]" >&2
}

kill_running_app
build_app

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    WHISPERDROP_RUNTIME_DIR="$RUNTIME_DIR" /bin/bash -x "$APP_EXECUTABLE"
    ;;
  --logs|logs)
    open_app
    tail -f /tmp/whisperdrop-launch.log
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    verify_app
    ;;
  *)
    usage
    exit 2
    ;;
esac
