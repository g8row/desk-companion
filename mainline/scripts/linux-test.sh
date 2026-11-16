#!/usr/bin/env bash
# TB-7304X fastboot test from a Linux host. Every device command has a hard timeout.
# The Mac could not get a single byte through LK's `download:` (even 4 KB stalls, USB 3 port or USB 2 hub).
# This script checks whether a Linux host does better, and runs step 1 of TEST-PLAN.md (RAM-only `fastboot boot`).
#
#   mainline/scripts/linux-test.sh fetch    # download the boot images from the GitHub release into mainline/out/
#   mainline/scripts/linux-test.sh probe    # tablet in fastboot: raw protocol probe (16 B) — shows which phase stalls
#   mainline/scripts/linux-test.sh uploads  # tablet in fastboot: RAM-only uploads 4 KB → 4 MB (fastboot stage)
#   mainline/scripts/linux-test.sh boot [image]   # tablet in fastboot: step 1, `fastboot boot` (RAM only)
#   mainline/scripts/linux-test.sh flash [image]  # tablet in fastboot: WRITES the recovery partition (fb_send.py, pyusb)
#   mainline/scripts/linux-test.sh run            # tablet in fastboot: `oem reboot-recovery` (boots what `flash` wrote)
#   mainline/scripts/linux-test.sh shell          # wait for the mainline gadget, cancel the auto-reboot (mlsh.py wait)
#
# Only `flash` writes flash. After a stall LK is wedged until the tablet reboots (hold Power ~15 s).
# Stop any adb server first (`adb kill-server`), and nothing else should poll USB.
set -u
cd "$(dirname "$0")/../.."          # repo root
REL=mainline-test-1
OUT=mainline/out
T() { local s=$1; shift; timeout -k 2 "$s" "$@"; local r=$?; [ $r = 124 ] && echo "*** TIMEOUT after ${s}s: $*"; return $r; }

ping() { echo "== ping"; T 5 fastboot getvar version 2>&1; }

case "${1:-}" in
fetch)
  mkdir -p "$OUT"
  gh release download "$REL" -R g8row/desk-companion -D "$OUT" --clobber
  (cd "$OUT" && sha256sum -c SHA256SUMS) ;;
probe)
  adb kill-server 2>/dev/null
  ping || exit 1
  # needs pyusb (pip install pyusb) and USB access: run this script with sudo, or add a udev rule
  "${PY:-python3}" -I mainline/scripts/analysis/fb_probe.py "${2:-16}" "${3:-512}" ;;
uploads)
  adb kill-server 2>/dev/null
  ping || exit 1
  tmp=$(mktemp -d)
  for k in 4 64 512 4096; do
    head -c $((k*1024)) /dev/urandom > "$tmp/blob$k"
    echo "== stage ${k}KB"; T 20 fastboot stage "$tmp/blob$k" 2>&1 || { echo ">> stalled at ${k}KB"; exit 2; }
  done
  ping ;;
boot)
  adb kill-server 2>/dev/null
  ping || exit 1
  img=${2:-$OUT/boot-stock-kernel-initramfs.img}
  echo "== fastboot boot $img"; T 60 fastboot boot "$img" 2>&1; echo "exit=$?" ;;
flash)
  img=${2:-$OUT/boot-mainline.img}
  T 120 "${PY:-python3}" -I mainline/scripts/analysis/fb_send.py "$img" flash:recovery ;;
run)
  T 20 "${PY:-python3}" -I mainline/scripts/analysis/fb_send.py - "oem reboot-recovery" ;;
shell)
  T 250 python3 -I mainline/scripts/mlsh.py wait ;;
*) sed -n 2,16p "$0"; exit 1 ;;
esac
