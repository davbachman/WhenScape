#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
    echo "Building WhenScape.saver requires macOS and Xcode. Run scripts/test-saver.sh to test the portable core."
    exit 1
fi
source scripts/sundial-common.sh
saver_astronomy
product="${WHENSCAPE_SAVER_PRODUCT_DIR:-$PWD/build}"
mkdir -p "$product"
product="$(cd "$product" && pwd -P)"
stage="$(mktemp -d "$product/.saver-XXXXXXXX")"
trap 'rm -rf "$stage"' EXIT

bundle="$stage/WhenScape.saver"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp Support/WhenScapeSaver/Info.plist "$bundle/Contents/Info.plist"
cp "$ASTRONOMY_DIR/LICENSE" "$bundle/Contents/Resources/Astronomy-Engine-LICENSE.txt"
cp LICENSE "$bundle/Contents/Resources/WhenScape-LICENSE.txt"
plutil -lint "$bundle/Contents/Info.plist"

read -r -a archs <<< "${WHENSCAPE_SAVER_ARCHS:-arm64 x86_64}"
if [[ "${#archs[@]}" -lt 1 ]]; then echo "Select at least one architecture."; exit 1; fi
slices=()
for arch in "${archs[@]}"; do
    xcrun clang -arch "$arch" -mmacosx-version-min=14.0 -std=c11 -O2 \
        -c "$ASTRONOMY_DIR/astronomy.c" -o "$stage/astronomy-$arch.o"
    xcrun clang++ -arch "$arch" -mmacosx-version-min=14.0 -std=c++17 -O2 -fobjc-arc -bundle \
        -I"$ASTRONOMY_DIR" "$SAVER_SOURCES/"*.cpp "$SAVER_SOURCES/"*.mm "$stage/astronomy-$arch.o" \
        -framework AppKit -framework SceneKit -framework ScreenSaver \
        -o "$stage/saver-$arch"
    slices+=("$stage/saver-$arch")
done
xcrun lipo -create "${slices[@]}" -output "$bundle/Contents/MacOS/WhenScapeSaver"
xcrun lipo "$bundle/Contents/MacOS/WhenScapeSaver" -verify_arch "${archs[@]}"
codesign --force --sign - "$bundle"
codesign --verify --strict "$bundle"

xcrun clang++ -std=c++17 -O2 -fobjc-arc -mmacosx-version-min=14.0 -I"$SAVER_SOURCES" \
    Support/WhenScapeSaver/Preview.mm -framework AppKit -framework SceneKit -framework ScreenSaver -o "$stage/WhenScapePreview"
mv -f "$stage/WhenScapePreview" "$product/WhenScapePreview"
if [[ -e "$product/WhenScape.saver" ]]; then mv "$product/WhenScape.saver" "$stage/previous.saver"; fi
mv "$bundle" "$product/WhenScape.saver"
echo "Built $product/WhenScape.saver"
