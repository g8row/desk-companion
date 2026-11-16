# Mainline Linux on the Lenovo TB-7304X (MT6737M): research and first boot images

Status (2026-11-16): **built, not tested on the device.** Nothing here has been written to or run on the tablet.
The run steps are in [TEST-PLAN.md](TEST-PLAN.md).

## TL;DR

- A working MT6735-family mainline kernel exists: **gitlab.com/mt6735-mainline/linux**, 7.0.10, the same one postmarketOS
  packages as `linux-postmarketos-mediatek-mt6735`. Our MT6737M is close to the Doogee X5 Pro (MT6735P) in that tree.
- **Stock LK has no `fastboot boot` command** (found by disassembly, details below). A RAM-only test through LK fastboot is
  therefore expected to fail. The fallback is flashing the **recovery** partition (backed up) and running
  `fastboot oem reboot-recovery`. That writes flash, so it needs the user's OK.
- Built: `out/boot-mainline.img` (mainline + new DTS + sign-of-life initramfs), `out/boot-mainline-noovl.img`
  (safer framebuffer probing), and `out/boot-stock-kernel-initramfs.img` (control: stock 3.18 kernel + same initramfs).
  All use the stock header layout, which we verified by re-packing the stock `boot.bin` byte-for-byte.
- Sign of life without a panel driver:
  - The screen is painted red, then green, then blue, on the framebuffer LK left running.
  - A USB gadget (ACM serial shell + ECM ethernet 172.16.42.1 with telnet and http) shows up on the Mac.
  - The tablet reboots itself after 300 s.

## 1. Research findings

### Mainline MT6735 / MT6737 state
- Kernel tree: `https://gitlab.com/mt6735-mainline/linux`, branch `mt6735-stable-7.0.y`, tag `v7.0.10-mt6735`,
  commit **046883c0c2b956fd7436d3c1156f25512d1f6a90** ("arm64: dts: mediatek: Add support for Doogee X5 Pro", 2026-05-30).
  Other branches include `mt6735-staging` (newer work), `mt6735-stable-6.19.y` and the older `6.1.y`. Maintainer:
  Yassine Oudjana (Tooniis).
- postmarketOS: `device/*/linux-postmarketos-mediatek-mt6735` in pmaports (we used commit
  `ce3ebdba08cdd09a6fb9a01da7d750f05638a25e`) packages exactly that tag, pkgver 7.0.10. We took its kernel config as our base.
  The only pmOS device that used it, `samsung-grandpplte` (MT6737T), is now **archived**. It booted through U-Boot,
  not stock LK.
- DTS in the tree: `mt6735.dtsi`, `mt6735m.dtsi` (MT6735M/P pinctrl + pwrap variant), `mt6328.dtsi` (PMIC),
  `mt6735p-doogee-x5pro.dts` and `mt6737t-samsung-grandpplte.dts`.
- Drivers present for the platform:
  - clocks (topckgen, apmixed, infra, peri, mm, img, vdec, venc, mfg), pinctrl, pwrap + MT6328 regulators and keys
  - SCPSYS power domains, mtk-sd MMC, musb USB + tphy, i2c, watchdog, SMI/M4U
  - DRM display path (ovl, rdma, color, dither, dsi, mipi-tx), Mali-T720 node (panfrost)
  - The pmOS 6.1.9 update notes say DRM display "replaces simplefb".
- Known caveats from the Doogee DTS:
  - "Secondary CPUs are broken on this platform due to firmware issues": only CPU0 is used.
  - The VEN power domain does not come up.
  - The Doogee DTS boots with `clk_ignore_unused pd_ignore_unused regulator_ignore_unused`.
- Gaps for this tablet:
  - **WiFi/BT/GPS/FM (MT6625L via CONSYS/WMT): no mainline driver.** Biggest blocker for daily use.
  - Panel: a DSI panel driver is needed for whichever LCM it has (below). Until then, simplefb on LK's buffer.
  - Touch: Goodix GT9293 is supported by the mainline `goodix` driver. FocalTech FT5x46 by `edt-ft5x06`.
  - Charger SM5414: no mainline driver. Battery/fuel gauge: none.
  - Modem: none. Audio: none.
- **MT6737M vs MT6735:** MediaTek's MT6737/MT6737M/MT6737T are re-spins of MT6735/MT6735M (same CPU cluster, same
  peripheral map). The device reports `ro.hardware=mt6735`, and the stock DTB says `model = "MT6735M"` with
  `mediatek,mt6735m-*` compatibles. The postmarketOS wiki redirects the MT6737 and MT6737M pages to MT6735. So we use
  `mt6735m.dtsi` unchanged. Not verified: per-chip efuse/speed-bin differences (they only matter for DVFS, which we don't use).
- Similar tablets: no mainline port for any Lenovo MT6735/MT6737 tablet was found. The closest base is the Doogee X5 Pro DTS.

### Stock LK (bootloader) — from disassembling `backup/partitions/lk.bin`
The analysis scripts are in `scripts/analysis/`. The LK image has a 0x200-byte MTK header. Code is ARM32/Thumb-2,
linked at 0x41E00000 (taken from the reset-vector literals), position-independent (`ldr rX,[pc]; add rX,pc`).
Fastboot product string: `HQ8735B_TB_N`.
- **Fastboot commands registered** (one function at 0x41e20dfe..0x41e20f82):
  - `getvar:`, `download:`, `flash:`, `erase:`, `continue`, `reboot`, `reboot-bootloader`
  - `oem p2u`, `oem reboot-recovery`, `oem append-cmdline`, `oem off-mode-charge`
  - The string `boot` exists only as the tail of `fastboot`. It is used elsewhere as a partition name, never in that
    function. **Conclusion: no `fastboot boot`** (LK answers "unknown command"). Confidence: high, but untested on the device.
- Kernel loading (function around 0x41e1f480):
  - It checks `hdr->kernel_addr & 0x7FFFF == 0`; otherwise "64 bit kernel can't boot at …".
  - It finds the DTB by **scanning backwards from the end of the kernel blob for `d0 0d fe ed`**, so an appended DTB
    works, same as stock.
  - It gunzips the kernel to `kernel_addr` with a **max output of 0x1C00000 (28 MiB)**. Our Image is 26.9 MB, so it fits
    with 2.4 MB headroom. `build-in-docker.sh` checks this limit.
- MTK 512-byte "mkimg" headers on the kernel/ramdisk are **optional** (LK logs "no mkimg header in kernel image" and
  carries on). The stock image has none.
- LK passes `/chosen` properties to the kernel: `atag,videolfb` (fb_base, islcmfound, fps, vram, lcmname),
  `atag,boot`, `atag,mem`, `atag,devinfo`, `atag,mdinfo`, `atag,meta`, `linux,initrd-*`, and `bootargs`.
  It also rewrites `/memory` from its mblock table and needs `bootopt=64S3,32N2,64N2` in the cmdline to pick a 64-bit
  boot. Its default cmdline string mentions `console=ttyMT3,921600n1`.
- Not proven from the binary: whether LK leaves the hardware watchdog (TOPRGU) armed when it jumps to the kernel.

### Stock boot image (`backup/partitions/boot.bin`)
- Android boot header v0, page 2048, `kernel_addr 0x40080000`, `ramdisk_addr 0x44000000`, `second_addr 0x40f00000`,
  `tags_addr 0x4e000000`, so base 0x40000000 with offsets kernel 0x80000, ramdisk 0x04000000, second 0x00f00000,
  tags 0x0e000000.
- Other header fields: os_version 7.0.0 / 2018-07, board/name `1535456354`, cmdline `bootopt=64S3,32N2,64N2`.
- Kernel: gzip arm64 Image (17.8 MB, `Linux version 3.18.35+ … Tue Aug 28 2018`, build path
  `ZA1962_601__A/kernel-3.18`), followed by a 65694-byte DTB.
- No MTK headers. The ramdisk is the stock Android one, not Magisk's.
- `mkbootimg --base 0x40000000 --kernel_offset 0x80000 --ramdisk_offset 0x04000000 --second_offset 0xf00000
  --tags_offset 0x0e000000 --pagesize 2048 --header_version 0 --os_version 7.0.0 --os_patch_level 2018-07 --board 1535456354`
  re-creates `boot.bin` **byte-identically**. We also patch second_addr back to 0x40f00000, because Debian's mkbootimg
  writes 0 there.

### Stock DTB (`stock/stock.dts`, decompiled)
- Model `MT6735M`, compatible `mediatek,MT6735M`. PSCI 0.1 (`method = "smc"`, cpu_on 0x84000003). 4× Cortex-A53.
- Memory placeholder `0x40000000 + 0x1f000000`; LK rewrites it (real RAM is 1 GB).
- Reserved memory:
  - ATF @0x43000000 (+0x30000)
  - `ram_console` @0x43f00000, `pstore` @0x43f10000 (+0xe0000), `minirdump` @0x43ff0000
  - CCCI modem (dynamic, 0x3810000), CONSYS (dynamic, 1 MB)
- MTKFB node: `reg = <0x7f000000 0x1000000>`, top 16 MB of the 1 GB. This is a placeholder: the real address comes from
  LK's `atag,videolfb`.
- UARTs: `apuart0..3` @0x11002000/3000/4000/5000. Stock bootargs `console=ttyMT0,921600n1`. No UART pads are known.
- eMMC: msdc0 @0x11230000, 8-bit, HS200/HS400 1.8 V. SD: msdc1 @0x11240000, 4-bit UHS.
- USB: `usb20@11200000` (musb), phy @0x11210000, `drvvbus` GPIO 83, `iddig` GPIO 67.
- I2C buses:
  - i2c0: cameras 0x10 / 0x3c
  - **i2c1: touch Goodix `cap_touch@5d`** (kernel strings: `GT9293,BOE`, `GT9293,GX`, `GT9293,NEW_GX`), alternative
    FocalTech FT5x46 `@38`. Touch EINT 10, `tpd-resolution 600x1024`, 5 fingers.
  - i2c2: accelerometer `@4c` / `@18`, capsensor `@28` / `@20`
  - **i2c3: charger SM5414 `@49`** (EINT 68, chgen GPIO 124, nINT GPIO 68, shdn GPIO 63)
- **PMIC: MT6328** via pwrap (kernel strings `mediatek,mt6328`, `mt6328_dump_register`). Keypad: hardware power key
  plus volume keys on the keypad matrix (map 0x73 / 0x72).
- **LCM** (panel): GPIOs `gpio_lcd_pwr` 83, `gpio_lcd_rst` 146. LK and the kernel contain four drivers and pick one by
  reading the panel ID:
  - `nt51021b_dsi_vdo_dj`
  - `nt51021b_dsi_vdo_gx`
  - `nt35521z_dsi_vdo_gx`
  - `hx8394d_dsi_vdo_boe`

  All are DSI video mode. Which one this unit has is **unknown**. A cheap read-only check on Android:
  `adb shell su -c 'dmesg | grep -i -m5 lcm; cat /proc/cmdline'`. Our test kernel also prints it (`lkfb:` line).

## 2. What we built

| File | Purpose |
|---|---|
| `dts/mt6737m-lenovo-tb7304x.dts` | Minimal board DTS (from the Doogee X5 Pro DTS and the stock DTB). See below. |
| `patches/mtk-lk-fb.c` | New tiny driver, `CONFIG_MTK_LK_FB`. See below. |
| `patches/0001-soc-mediatek-mtk-lk-fb.sh` | Idempotently adds the driver and DTS to the kernel tree (Kconfig, Makefile, dts Makefile). |
| `patches/config-tb7304x.fragment` | Appended to the pmOS config. See below. |
| `initramfs/init`, `initramfs/lkpaint.c` | Busybox init and a static screen-fill tool. Work on both mainline and the stock 3.18 kernel. See below. |
| `scripts/Dockerfile`, `scripts/build.sh`, `scripts/build-in-docker.sh` | Reproducible build (OrbStack/Docker, Debian trixie arm64, native gcc 14.2, Debian `mkbootimg` 34.0.5, busybox-static 1.37.0). |
| `scripts/analysis/*.py` | LK disassembly helpers: string references and Thumb disassembly with string annotation. |
| `stock/` | Stock kernel, `Image`, `stock.dtb`/`stock.dts`, `lk.strings` (all extracted from backups). |
| `out/` | Build outputs plus `SHA256SUMS`, `kernel.config`, `build.log`, LK disassembly excerpts. |

The DTS (`dts/mt6737m-lenovo-tb7304x.dts`):
- 1 CPU
- uart0, eMMC at a conservative 50 MHz (no HS200/HS400 tuning)
- pwrap + MT6328
- musb in `dr_mode = "peripheral"`
- ramoops at the stock pstore address, and the MTK `ram_console`/`minirdump` areas kept no-map

The driver (`patches/mtk-lk-fb.c`, `CONFIG_MTK_LK_FB`):
- It reads `/chosen/atag,videolfb` and the OVL0 layer registers @0x14007000: enable, address, pitch, size, format.
- It registers a `simple-framebuffer` platform device, so **simpledrm + fbcon** draw on the panel LK already lit.
- It logs everything with the prefix `lkfb:`.
- Cmdline overrides: `lkfb.addr= lkfb.stride= lkfb.width= lkfb.height= lkfb.format= lkfb.ovl=0 lkfb.enable=0`.

The config fragment (`patches/config-tb7304x.fragment`):
- no modules, `DRM_MEDIATEK` off (so nothing reprograms the display)
- simpledrm + fbdev + fbcon + logo
- `/dev/mem` without STRICT_DEVMEM
- embedded initramfs
- pstore/ramoops, mtk watchdog, USB configfs (ACM/ECM/RNDIS)

The initramfs (`initramfs/init`, `initramfs/lkpaint.c`):
- It paints red, green, then blue: through `/dev/fb0`, or else through `/dev/mem` at LK's `fb_base`.
- It sets up a USB gadget: configfs on mainline, `android_usb` on the stock kernel. Vendor 0x1d6b, product 0x0104.
- Services: CDC-ACM root shell, ECM network 172.16.42.1 with DHCP for 172.16.42.2, telnetd, and httpd serving
  `init.log`, `dmesg.txt` and `status.txt`.
- It reboots itself after `tb.autoreboot=` seconds (default 300) unless `/tmp/stay` exists. If the reboot hangs, an
  unpetted `/dev/watchdog` is the fallback.

### Images (`out/`)
| Image | Kernel | Cmdline (LK appends its own items) |
|---|---|---|
| `boot-mainline.img` (13.3 MB) | 7.0.10-tb7304x+ Image.gz + `mt6737m-lenovo-tb7304x.dtb` | `bootopt=64S3,32N2,64N2 console=tty0 clk_ignore_unused pd_ignore_unused regulator_ignore_unused maxcpus=1 ignore_loglevel panic=10 oops=panic tb.autoreboot=300` |
| `boot-mainline-noovl.img` | same | same + `lkfb.ovl=0` |
| `boot-stock-kernel-initramfs.img` (8.9 MB) | stock 3.18 kernel+DTB, byte-for-byte | `bootopt=64S3,32N2,64N2 panic=10 tb.autoreboot=300` |

All three fit in the 16 MiB recovery partition. Hashes are in `out/SHA256SUMS`. Builds are reproducible in content
but not bit-for-bit: build timestamps and the kernel build number change.

### Rebuild
```sh
cd mainline
./scripts/build.sh          # ~5 min cold on M-series (10 cores), ~1 min incremental; output in out/build.log
```
`build.sh`:
- builds the `tb7304-build` image
- clones the kernel and pmaports if they are missing
- uses the Docker volume `tb7304-kbuild` for kernel objects
- re-checks the stock repack and the size limits

## 3. Honest list of unknowns / risks
1. **`fastboot boot`**: almost certainly unsupported (see above). The flash-recovery route is untested. We assume, but did
   not verify, that `oem reboot-recovery` is a one-shot request.
2. **Display:** we assume LK leaves the panel running in DSI video mode, scanning OVL0 from `atag,videolfb.fb_base`.
   Other assumptions:
   - The atag struct layout (`u64 fb_base; u32 islcmfound, fps, vram; char lcmname[]`) comes from MTK sources of this
     era. It is not verified for this LK build.
   - The OVL register offsets come from the mt8173-compatible OVL that the mt6735 DTS uses.
   - If reading OVL hangs the bus (display clocks gated), use the `-noovl` image.
3. **USB gadget on mainline:** musb is in pmOS's config and the Doogee DTS. It is untested on MT6737M. VBUS/ID detection
   is not wired up; we force peripheral mode.
4. **SMP:** disabled (`maxcpus=1`, only cpu0 in the DT), following the Doogee notes.
5. **No charger driver.** Keep the battery charged and keep the test short (auto-reboot helps).
6. **Watchdog:** mainline `mtk_wdt` (TOPRGU, 10 s) pets the watchdog from the kernel. Whether LK hands over an armed
   watchdog is unknown. If the kernel hangs before the watchdog driver probes, recovery may need a long press on Power.
7. **eMMC:** probed (read-only use: init never mounts anything) at 50 MHz. If mmc init misbehaves it only costs a
   storage device in `/proc/partitions`.

## 4. Next steps after a successful boot
1. Read `lkfb:` and `musb` lines from `dmesg.txt`. Pin the framebuffer in DT (`simple-framebuffer` + reserved-memory)
   and drop the OVL probing.
2. Identify the LCM, then write or port a `drm_panel` driver (nt51021b / nt35521z / hx8394d init sequences are in the
   stock kernel and LK) and enable `DRM_MEDIATEK` with dsi0.
3. Touch: add `goodix,gt9293`-compatible on i2c1 @0x5d (IRQ GPIO 10, reset GPIO from the stock pinctrl) and enable i2c1.
4. SMP: test `psci` CPU_ON with stock ATF (the Doogee note says it is broken; it may differ here).
5. WiFi: no mainline path today (MT6625L/CONSYS). This decides whether mainline is usable as a daily OS here.
6. Long term: a chain-loaded U-Boot (`gitlab.com/alifilhan0/u-boot`, MT6735 port, used by grandpplte) would give a
   proper `fastboot boot`-like RAM loader without touching LK.

## Sources
- mt6735 mainline group: https://gitlab.com/mt6735-mainline (kernel: https://gitlab.com/mt6735-mainline/linux)
- pmOS package: https://pkgs.postmarketos.org/package/main/postmarketos/aarch64/linux-postmarketos-mediatek-mt6735
- pmaports: https://gitlab.postmarketos.org/postmarketOS/pmaports (commit ce3ebdba08cd)
- pmOS wiki MT6735 page (redirects from MT6737/MT6737M): https://wiki.postmarketos.org/wiki/MediaTek_MT6735 (bot-blocked for us; status from search snippets)
- pmaports MR 3839 (6.1.9: full DRM display support): https://gitlab.postmarketos.org/postmarketOS/pmaports/-/merge_requests/3839
- MT6735 U-Boot port: https://gitlab.com/alifilhan0/u-boot
- MediaTek LK background: https://www.lieberbiber.de/?p=149
