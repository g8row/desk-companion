#!/bin/sh
# Host entry point (macOS + OrbStack/Docker). Reproduces everything in mainline/out/.
set -e
M=$(cd "$(dirname "$0")/.." && pwd)
docker build -t tb7304-build -f "$M/scripts/Dockerfile" "$M/scripts"
[ -d "$M/src/linux" ] || git clone --depth 1 -b mt6735-stable-7.0.y https://gitlab.com/mt6735-mainline/linux.git "$M/src/linux"
[ -d "$M/src/pmaports" ] || { git clone --depth 1 --filter=blob:none --sparse https://gitlab.postmarketos.org/postmarketOS/pmaports.git "$M/src/pmaports";
  (cd "$M/src/pmaports" && git sparse-checkout set --no-cone '/device/*/linux-postmarketos-mediatek-mt6735/*'); }
docker volume create tb7304-kbuild >/dev/null
docker run --rm -v "$M":/m -v tb7304-kbuild:/kout -v "$M/../backup/partitions":/stock:ro tb7304-build bash /m/scripts/build-in-docker.sh
