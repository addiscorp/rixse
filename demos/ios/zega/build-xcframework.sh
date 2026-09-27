#!/bin/bash
# Builds the zega engine as ZegaEngine.xcframework for the iOS demo.
# Rust staticlibs are built on the iMac (or any machine with the two iOS
# targets); the XCFramework assembly needs xcodebuild, so run this on bugsy.
#
#   rsync the repo to bugsy, then:
#   demos/ios/zega/build-xcframework.sh <repo-root>
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
ZEGA_DIR="$ROOT/demos/ios/zega"
OUT="$ROOT/demos/ios/vendor"
export CARGO_TARGET_DIR="$ROOT/.target"
export TMPDIR="$ROOT/.tmp"

for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  if [ ! -f "$CARGO_TARGET_DIR/$target/release/libzega_ios.a" ]; then
    (cd "$ZEGA_DIR" && cargo build --locked --release --target "$target")
  fi
done

rm -rf "$OUT/ZegaEngine.xcframework"
xcodebuild -create-xcframework \
  -library "$CARGO_TARGET_DIR/aarch64-apple-ios/release/libzega_ios.a" -headers "$ZEGA_DIR/include" \
  -library "$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libzega_ios.a" -headers "$ZEGA_DIR/include" \
  -output "$OUT/ZegaEngine.xcframework"
echo "wrote $OUT/ZegaEngine.xcframework"
