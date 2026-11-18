#!/usr/bin/env bash
# Sourced from the repository root. Astronomy Engine matches the existing web
# app's version and is pinned to the source commit and hashes.
SAVER_BUILD_DIR="$PWD/.build/saver"
ASTRONOMY_DIR="$SAVER_BUILD_DIR/astronomy"
SAVER_SOURCES="$PWD/Sources/WhenScapeSaver"

saver_astronomy() {
    mkdir -p "$ASTRONOMY_DIR"
    local file hash temp
    while read -r hash file; do
        if ! (cd "$ASTRONOMY_DIR" && printf '%s  %s\n' "$hash" "$file" | shasum -a 256 -c - >/dev/null 2>&1); then
            temp="$(mktemp "$ASTRONOMY_DIR/download.XXXXXX")"
            local url="https://raw.githubusercontent.com/cosinekitty/astronomy/61dc07020aaa6885d2c7f688a4d82beaf6edb9ef"
            if [[ "$file" != LICENSE ]]; then url="$url/source/c"; fi
            if ! curl -fsSL --retry 2 --max-time 45 "$url/$file" -o "$temp" ||
                ! printf '%s  %s\n' "$hash" "$temp" | shasum -a 256 -c - >/dev/null; then
                rm -f "$temp"
                return 1
            fi
            mv "$temp" "$ASTRONOMY_DIR/$file"
        fi
    done <<'HASHES'
388920479d819713963ffd0f8ab0677944f66c6c94239ceddddd3b0d5d064432 astronomy.c
83a31011957c2b87e22f0828820f370f1a495aa4d51357bb57d714cde839dc00 astronomy.h
690dd98cb13ba4db77c6327deea852a816892bb9debbad5943405c66972f8023 LICENSE
HASHES
    "${CC:-cc}" -std=c11 -O2 -c "$ASTRONOMY_DIR/astronomy.c" -o "$SAVER_BUILD_DIR/astronomy.o"
}
