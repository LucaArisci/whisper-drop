#!/usr/bin/env bash
set -euo pipefail

APP_NAME="WhisperDrop"
VERSION="${1:-1.0.0}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/dist/$APP_NAME.app"
PACKAGE_DIR="$ROOT_DIR/build/package"
STAGING_DIR="$ROOT_DIR/build/dmg-staging"
DMG_PATH="$PACKAGE_DIR/$APP_NAME-$VERSION.dmg"

"$ROOT_DIR/scripts/build_macos_app.sh" >/dev/null

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$PACKAGE_DIR"
cp -R "$APP_BUNDLE" "$STAGING_DIR/$APP_NAME.app"
ln -s /Applications "$STAGING_DIR/Applications"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

rm -rf "$STAGING_DIR"
echo "$DMG_PATH"
