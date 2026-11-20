#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
    echo "The native app requires macOS 14+ with Xcode 15+ command-line tools. Use npm test and npm run preview to validate the scene on other systems."
    exit 1
fi
command -v swift >/dev/null || { echo "Install Xcode and select its command-line tools first."; exit 1; }
command -v npm >/dev/null || { echo "Install Node.js 22.17+ first."; exit 1; }
# Keep build caches in the project so managed builds do not need writes to the
# user's shared npm, SwiftPM or compiler caches. Explicit overrides still win.
export npm_config_cache="${npm_config_cache:-$PWD/.build/npm-cache}"
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$PWD/.build/module-cache}"
SWIFT_OPTIONS=(--cache-path "$PWD/.build/swiftpm-cache"
    --config-path "$PWD/.build/swiftpm-config"
    --security-path "$PWD/.build/swiftpm-security")
npm ci
npm run build
npm test
swift test "${SWIFT_OPTIONS[@]}"
swift build "${SWIFT_OPTIONS[@]}" -c release
BIN_DIR="$(swift build "${SWIFT_OPTIONS[@]}" -c release --show-bin-path)"
# Cloud file providers can continually add FinderInfo to .app/.bundle
# directories, invalidating code signing even after those attributes are
# removed. Store the app in local developer storage and keep the documented
# project path as a symlink. Override this for CI or another local product path.
PRODUCT_DIR="${WHENSCAPE_PRODUCT_DIR:-$HOME/Library/Developer/WhenScape}"
mkdir -p "$PRODUCT_DIR" "$PWD/build"
PRODUCT_DIR="$(cd "$PRODUCT_DIR" && pwd -P)"
APP_DIR="$PRODUCT_DIR/WhenScape.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/WhenScape" "$APP_DIR/Contents/MacOS/WhenScape"
cp Support/Info.plist "$APP_DIR/Contents/Info.plist"
ICON_DIR="$PRODUCT_DIR/AppIcon.iconset"
mkdir -p "$ICON_DIR"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" Support/AppIcon.png --out "$ICON_DIR/icon_${size}x${size}.png" >/dev/null
    retina=$((size * 2))
    sips -z "$retina" "$retina" Support/AppIcon.png --out "$ICON_DIR/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICON_DIR" -o "$APP_DIR/Contents/Resources/AppIcon.icns"
RESOURCE_BUNDLE="$BIN_DIR/WhenScape_WhenScape.bundle"
if [[ ! -d "$RESOURCE_BUNDLE" ]]; then
    echo "Expected SwiftPM resource bundle was not generated: $RESOURCE_BUNDLE"
    exit 1
fi
ditto --norsrc --noextattr --noacl "$RESOURCE_BUNDLE" "$APP_DIR/Contents/Resources/WhenScape_WhenScape.bundle"
# Sign with a development certificate when one is available, so macOS keeps
# granted permissions (such as calendar access) across rebuilds; an ad-hoc
# signature looks like a new app every time. WHENSCAPE_SIGN_IDENTITY overrides
# the choice ("-" forces ad-hoc signing, as in CI).
SIGN_IDENTITY="${WHENSCAPE_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/^ *[0-9][0-9]*) \([0-9A-F]\{40\}\) "Apple Development: .*/\1/p' | head -n 1)}"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
codesign --force --deep --sign "$SIGN_IDENTITY" "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
    echo "Signed ad hoc; macOS may ask again for calendar access after each rebuild."
else
    echo "Signed with a development certificate."
fi
APP_LINK="$PWD/build/WhenScape.app"
if [[ "$APP_LINK" != "$APP_DIR" ]]; then
    if [[ -d "$APP_LINK" && ! -L "$APP_LINK" ]]; then
        rm -rf "$APP_LINK"
    fi
    ln -sfn "$APP_DIR" "$APP_LINK"
fi
echo "Built $APP_LINK"
echo "Launch with: open build/WhenScape.app"
