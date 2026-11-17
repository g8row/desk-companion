# U-Boot for the TB-7304X (chainloaded by stock LK)

U-Boot 2023.04-rc1 from the mt6735 fork, pinned at `3d74bf1686`, packed as an Android boot image that stock LK
loads like a kernel. Status, test history and the next plan:
[docs/mainline/handoff-uboot-2026-11-17.md](../../docs/mainline/handoff-uboot-2026-11-17.md).

## Status (2026-11-17)

| Works | Only when LK enters through the RTC "reboot recovery" flag (`adb reboot recovery`, LK `oem reboot-recovery`) |
|---|---|
| ✅ | Console on LK's framebuffer, USB fastboot (`0e8d:201c`), `fastboot boot` of mainline Linux, eMMC read, `tbandroid` booting stock Android + Magisk in normal mode |
| ❌ | LK normal boot of U-Boot from `boot`, and LK BCB-recovery boot from `recovery`: logo, ~25 s, reset, loop. Cause unknown |

Keep U-Boot in `recovery` and Android in `boot`. Do **not** write a `boot-recovery` BCB to `para`: LK then skips
the volume-key menu and only BROM (mtkclient) gets the tablet back.

## Files

| File | Role |
|---|---|
| `tb7304x_defconfig` | Board config (text base `0x40080000`, top 16 MiB hidden, WDT 15 s, hush, MMC, video console, fastboot RAM only) |
| `mt6737m-lenovo-tb7304x.dts` | Control DT: simple-framebuffer `0x7f7b0000`, `mmc0` without pinctrl/regulators, USB peripheral |
| `tb7304x_entry.S` | Saves LK's DTB pointer (`x0`), paints the "entered" band |
| `tb7304x_debug.c` | Bands, LK display hand-over (OVL0 L0/L3), console start (`console_init_r`), status lines |
| `tb7304x_android.c` | `tb_lk_info` (reads LK's DT, picks `android_part`), `tbandroid` command |
| `boot.cmd` | Boot script, becomes the image's ramdisk; reads `/cache/linux/boot-target` (`target=android|linux|fastboot`) |
| `0001-musb-mt6735-register-dm-gadget-udc.patch` | Fixes the fork's MT6735 MUSB glue for DM gadget (fastboot) |
| `build-uboot.sh` | Builds in the `tb7304-build` container; outputs `out/u-boot-tb7304x.img` and `out/boot-mainline-uboot.img` |

## Build and install

```sh
scp mainline/u-boot/* $BUILD_HOST:$BUILD_DIR/mainline/u-boot/
ssh $BUILD_HOST "M=$BUILD_DIR/mainline; docker run --rm -v \$M:/m -v tb7304-ubuild:/uout tb7304-build bash /m/u-boot/build-uboot.sh"
scp $BUILD_HOST:$BUILD_DIR/mainline/out/u-boot-tb7304x.img mainline/out/
# from Android (root): write to recovery, verify with cmp, then `adb reboot recovery`
```

From LK fastboot use `mainline/scripts/fbusb mainline/out/u-boot-tb7304x.img flash:recovery`
(stock `fastboot` stalls on LK downloads; LK has no `fastboot boot`).
