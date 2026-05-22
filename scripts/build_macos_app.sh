#!/usr/bin/env bash
set -euo pipefail

APP_NAME="WhisperDrop"
BUNDLE_ID="com.whisperdrop.app"
MIN_SYSTEM_VERSION="12.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_SOURCE="$APP_RESOURCES/app"
APP_EXECUTABLE="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
ICON_SOURCE="$ROOT_DIR/assets/app-icon/whisperdrop-icon.png"
ICONSET_DIR="$DIST_DIR/$APP_NAME.iconset"
ICON_FILE="$APP_RESOURCES/$APP_NAME.icns"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_SOURCE/scripts"

cp "$ROOT_DIR/transcriber.py" "$APP_SOURCE/transcriber.py"
cp "$ROOT_DIR/requirements.txt" "$APP_SOURCE/requirements.txt"
cp "$ROOT_DIR/WhisperDrop.command" "$APP_SOURCE/WhisperDrop.command"
cp "$ROOT_DIR/scripts/setup.sh" "$APP_SOURCE/scripts/setup.sh"

if [ -d "$ROOT_DIR/assets" ]; then
  cp -R "$ROOT_DIR/assets" "$APP_SOURCE/assets"
fi

chmod +x "$APP_SOURCE/WhisperDrop.command"
chmod +x "$APP_SOURCE/scripts/setup.sh"

if [ -f "$ICON_SOURCE" ]; then
  rm -rf "$ICONSET_DIR"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET_DIR" -o "$ICON_FILE"
  rm -rf "$ICONSET_DIR"
fi

cat >"$APP_EXECUTABLE" <<'LAUNCHER'
#!/usr/bin/env bash
set -e

APP_EXEC_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTENTS_DIR="$(cd "$APP_EXEC_DIR/.." && pwd)"
APP_DIR="$CONTENTS_DIR/Resources/app"
RUNTIME_DIR="${WHISPERDROP_RUNTIME_DIR:-$HOME/Library/Application Support/WhisperDrop}"

mkdir -p "$RUNTIME_DIR"
export WHISPERDROP_APP_DIR="$APP_DIR"
export WHISPERDROP_RUNTIME_DIR="$RUNTIME_DIR"

exec "$APP_DIR/WhisperDrop.command"
LAUNCHER

chmod +x "$APP_EXECUTABLE"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleIconFile</key>
  <string>$APP_NAME</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

echo "$APP_BUNDLE"
