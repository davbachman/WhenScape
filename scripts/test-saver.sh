#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/sundial-common.sh
saver_astronomy
"${CXX:-c++}" -std=c++17 -O2 -Wall -Wextra -Werror -I"$ASTRONOMY_DIR" -I"$SAVER_SOURCES" \
    "$SAVER_SOURCES/Sundial.cpp" "$SAVER_SOURCES/Weather.cpp" Tests/WhenScapeSaverTests/SundialTests.cpp \
    "$SAVER_BUILD_DIR/astronomy.o" -o "$SAVER_BUILD_DIR/tests"
"$SAVER_BUILD_DIR/tests"
