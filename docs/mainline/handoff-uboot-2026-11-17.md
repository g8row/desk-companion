# Handoff: U-Boot chainload session, night of 2026-11-16 → 2026-11-17

**Written:** 2026-11-17, after the tablet was recovered. **Historical:** it records the state before the U-Boot work
was committed and before the live layout moved to `boot`; see [plan-dualboot.md](plan-dualboot.md) and
[STATUS.md](STATUS.md) for what is current.
**Branch:** `mainline-bringup` at the time (U-Boot work was uncommitted: `mainline/u-boot/`, `mainline/scripts/fbusb`).
**Read with:** [plan-boot-recovery.md](../../plan-boot-recovery.md) (the design this tested),
[STATUS.md](STATUS.md), [mainline/u-boot/README.md](../../mainline/u-boot/README.md).

> **Resolved later on 2026-11-17** ([research-lk-bootflow.md](research-lk-bootflow.md),
> [plan-dualboot.md](plan-dualboot.md)):
> - **§1, §4.1, §5 "only the RTC path works":** wrong conclusion. Inside LK, every route behaves the same. LK loads
>   the DTB from the last 512 KiB of the kernel area in the partition. Our U-Boot kernel area (0x5883b) was too
>   small, so LK used whatever DTB the previous boot left at `0x4e000000`.
>   - The RTC runs worked because the previous Android had been started by LK.
>   - P2 failed because its previous Android had been started by U-Boot and then did heavy I/O. Reproduced as T0,
>     fixed by padding the image (T1).
>   - BCB and P2b stay unexplained, and neither route is used any more.
> - **§6.1** (the double-buffered framebuffer hypothesis) is not needed. U-Boot never ran in the failing boots.
> - **§7:** decided: option B, U-Boot in `boot`. LK accepts any image that meets research-lk-bootflow §4.
> - **P1's `ro.boot.mode=normal`** was also left over in RAM. `tbandroid` now patches `/firmware/android/mode` too.
> - **The layout in §2 is outdated.** Since 12:46, `boot` = padded U-Boot (`672f2f9a…`) and `recovery` = Android +
>   Magisk. `adb reboot recovery` now starts Android directly in LK recovery mode, and U-Boot no longer runs on that
>   route.
> - **New bug:** `fastboot continue` in U-Boot resets the tablet.

---

## 1. One-paragraph summary

We got a U-Boot (2023.04-rc1 mt6735 fork) chainloaded by stock LK to the point where it draws a console on the
panel, runs USB fastboot, RAM-boots mainline Linux, reads the eMMC, and boots **stock Android with Magisk** using
the device tree LK prepared. All of that works **only when LK starts U-Boot through the RTC "reboot recovery"
flag** (`adb reboot recovery`, `oem reboot-recovery`). When LK starts the same binary any other way (normal
power-on from `boot`, or recovery via the `boot-recovery` BCB in `para`) the tablet shows the LK logo for about
25 s, gets reset (very likely a watchdog), and loops. U-Boot's first instruction paints a white band and that band
never appears in those paths, so either LK never jumps, or U-Boot runs on a framebuffer the panel is not scanning.
The BCB experiment also locked us out of the volume-key boot menu; we recovered with mtkclient (sudo, BROM).
The tablet is back to the **Phase 1 layout**, which works.

---

## 2. Tablet state now (verified 2026-11-17 ~11:40)

| Partition | Content | sha256 (image part) |
|---|---|---|
| `boot` | Stock Android + Magisk 31.1 (original) | `5c732e97…` (`backup/partitions/2026-11-17/boot-magisk.img`) |
| `recovery` | U-Boot image | `bc5937ad…` (= `mainline/out/u-boot-tb7304x.img`, = `backup/…/recovery-uboot.img`) |
| `para` (`/misc`) | Original, first 2 KiB zero, **no BCB** | `backup/partitions/2026-11-17/para-before-bcb.bin` |
| `cache` | `/cache/linux/{rootfs.img, bootcount, boot-mainline-uboot.img}`; **no** `boot-target` | — |

Behaviour:
- Power-on / `adb reboot` → LK normal → **Android** from `boot`. Fine.
- `adb reboot recovery` → LK (RTC flag) → **U-Boot** → `boot.cmd` → `tbandroid` boots Android from `boot`.
  Verified Phase 1 (Android up in ~53 s, `ro.boot.mode=normal`, Magisk root, display, WDK kicking).
- To RAM-boot Linux: create `/cache/linux/boot-target` with `target=fastboot`, `adb reboot recovery`, then
  `fastboot boot mainline/out/boot-mainline-uboot.img` (U-Boot fastboot, `0e8d:201c`, stock `fastboot` works
  against U-Boot). Or `target=linux` to boot `/cache/linux/boot-mainline-uboot.img`.
- **Mainline kernel #24 is no longer in `recovery`.** `linux-test.sh to-recovery` now lands in U-Boot, not Linux.

---

## 3. What was built (all in `mainline/u-boot/`, built on the build host in `tb7304-build`)

| Piece | What it does |
|---|---|
| `tb7304x_defconfig` | `TEXT_BASE 0x40080000`, `OF_SEPARATE`, `SYS_MEM_TOP_HIDE 0x01000000` (keeps LK's framebuffers out of Linux's memory), `WDT_MTK` autostart (15 s), hush, `MMC_MTK`, `VIDEO_SIMPLE` console white-on-black, fastboot buffer `0x50000000`/`0x7000000`, **fastboot flash off**, no GPT/ext4/FAT write, no UMS. `BOOTCOMMAND = version; source 0x44000000; …fallback fastboot; reset`. |
| `mt6737m-lenovo-tb7304x.dts` | U-Boot's control DT: reserved-memory + `simple-framebuffer` at `0x7f7b0000` (600×1024, stride 2432), `mmc0` enabled **without** pinctrl/regulators (LK left the eMMC powered), max 52 MHz, `usb0` peripheral, pwrap/uarts/mmc1 off. |
| `tb7304x_entry.S` | `save_boot_params`: stores LK's `x0` (its patched DTB) in `tb_lk_fdt`, paints a white band at rows 896–991 of `0x7f7b0000` as "U-Boot was entered". |
| `tb7304x_debug.c` | Progress bands (fallback if the console fails), display handover (clear L0 alpha-enable, hide LK's orange-state L3 layer), `video_clear`, `fdt_high`/`initrd_high = 0x4c000000`, console on `serial,vidconsole` with `stdin=nulldev`, **calls `console_init_r()`** (the fork's `HACK: disable console_init_r` commit kills printf otherwise), USB gadget probe, prints status, `tb_lk_info()`. |
| `tb7304x_android.c` | `tb_lk_info()` prints LK's DT (bootargs, initrd, memory) and sets `android_part` from LK's `atag,boot` bootmode (recovery → Android is in `boot`, else in `recovery`). `tbandroid <addr>`: checks ranges, copies LK's DT to `0x4f000000`, sets `linux,initrd-*`, patches `atag,boot` bootmode recovery → normal, gunzips the kernel to `0x40080000`, copies the ramdisk to `0x44000000`, restores LK's OVL L0/L3 controls, jumps with `x0` = DT. No `bootm` (it would rewrite memory and bootargs the 3.18 kernel takes from LK). |
| `boot.cmd` | Becomes the image's ramdisk (LK loads it at `0x44000000`). Reads `target=` from `/cache/linux/boot-target` (android default, linux, fastboot), then `mmc read` the Android partition and `tbandroid`. Falls back to fastboot, then reset. |
| `0001-musb-mt6735-register-dm-gadget-udc.patch` | Fork bug: under `DM_USB_GADGET` the MT6735 glue never created a controller and passed the wrong pointer to the IRQ handler. Now `musb_init_controller()` + `usb_add_gadget_udc()`. |
| `build-uboot.sh` | Copies board files into the pinned tree (`3d74bf1686`), applies `0*.patch` once, checks Kconfig, gzips `u-boot.bin` and **appends the stock Android DTB** (`mainline/stock/stock.dtb`, identical to the one in `boot`) so LK patches an Android-shaped tree, packs `out/u-boot-tb7304x.img` (Android image, `bootopt=64S3,32N2,64N2`, tags `0x4e000000`). Also makes `out/boot-mainline-uboot.img` (mainline kernel at offset `0x200000`, DTB in `second`, long cmdline). |
| `mainline/scripts/fbusb` | pyusb fastboot client for **LK** (stock `fastboot` stalls on LK downloads). Venv in `tools/fbusb-venv` (gitignored). LK fastboot has **no `boot` command**; only `flash:`, `oem reboot-recovery`, `reboot`, `getvar`. |

---

## 4. Timeline and results

Times are local (EET).

| # | When | Test | Result |
|---|---|---|---|
| 1–4 | 22:39–23:40 | Display bring-up runs (U-Boot in `recovery`, RTC path) | Bands visible; LK logo showed through (L0 alpha) and orange-state overlay on top (L3). Fixed: clear L0 AEN, L3 alpha 0. Colours correct (run 4). |
| 5 | 23:45 | Why no `printf` on screen | Fork comments out `console_init_r`; `GD_FLG_DEVINIT` never set. |
| 6 | 23:48 | Console from board code | ✅ `printf`, `version` on screen. `fastboot usb 0` → "couldn't find an available UDC". |
| 7 | 23:56 | MUSB patch + `fastboot boot` mainline | ✅ U-Boot fastboot `0e8d:201c` ~14 s after `adb reboot recovery`; `fastboot boot boot-mainline-uboot.img` → Alpine up (kernel #24, 4 cores, mediatekdrmfb). Issues: `Kernel image misaligned`, `failed to reserve memory for node memory@78000000` (U-Boot put DT/initrd at top of RAM) → fixed with `fdt_high/initrd_high` + 2 MiB kernel offset, **not yet verified on device**. |
| 7b | ~00:00 and ~00:06 | Linux sessions ended | Android came back with `bootreason=wdt_by_pass_pwk` both times, a few minutes after boot. **Not diagnosed**: may be the 300 s `tb-autoreboot` (sysrq `b` resets through the WDT) or a real hang/WDT. User reported "linux crashed again". |
| P1 | 00:12 | **Phase 1:** U-Boot in `recovery`, Android in `boot`, `adb reboot recovery` | ✅ U-Boot → `tbandroid` → Android. `bootreason=rtc`, `ro.boot.mode=normal`, `boot_completed=1`, Magisk root, display OK, WDK kicking, MemTotal 918 MB (stock is the same). |
| P2 | 00:16 | **Phase 2:** U-Boot in `boot`, Android in `recovery`, plain `adb reboot` | ❌ Loop: LK logo + orange-state text ~25 s, black, preloader re-enumerates every ~32 s. No U-Boot band. User reached LK fastboot through the volume menu. |
| — | 00:26 | `fbusb` built; `oem reboot-recovery` | ✅ Android from `recovery` (LK recovery mode, `ro.boot.mode=recovery`, Magisk OK). `last_kmsg` held only the earlier clean `adb reboot`, so **no kernel ran during the loop**. `expdb` empty. |
| P2b | 00:34 | Same layout, `fbusb reboot` from LK fastboot, camera recording | ❌ Same loop, period ~32 s, only "MT65xx Preloader" on USB. Frames: LK "desk" logo + orange-state text, no white band. |
| BCB | 01:05 | Phase 1 layout restored + `boot-recovery` written to `para` (LK honors BCB per `mboot_recovery_load_misc`) | ❌ LK took the recovery path (loaded U-Boot from `recovery`) and looped the same way, ~20–30 s. **Volume-key menu no longer reachable** (BCB evaluated first). |
| Rescue | 11:33–11:38 | mtkclient `w para para-before-bcb.bin` | Preloader-mode handshake kept failing (and a sandbox write error on `hwparam.json`); user ran it with **sudo in Terminal** → ✅. Android back, `ro.boot.mode=normal`. |

### 4.1 The matrix that matters

| LK entry path | Image LK loads | U-Boot band seen? | Outcome |
|---|---|---|---|
| RTC flag recovery (`adb reboot recovery`, `oem reboot-recovery`) | U-Boot from `recovery` | ✅ | **works** (many runs) |
| Normal (power-on / `adb reboot` / LK `reboot`) | U-Boot from `boot` | ❌ | loop ~32 s |
| BCB `boot-recovery` in `para` | U-Boot from `recovery` | ❌ | loop ~20–30 s |
| Normal | Android from `boot` | n/a | works |
| RTC recovery / LK menu | Android from `recovery` | n/a | works (Android runs with `ro.boot.mode=recovery`) |
| Volume-menu "Recovery Mode" | U-Boot from `recovery` | **not tested** | — |
| Normal | **mainline Linux** from `boot` | **not tested** | — |

Same U-Boot binary in every row. The only variable is how LK got there.

---

## 5. What we know, what we don't

**Known**
- LK's normal and BCB paths do not lead to a visible U-Boot. The loop period (~32 s ≈ preloader 4 s + LK 8 s incl.
  the 5 s orange-state wait + ~15–20 s) is consistent with **U-Boot's own 15 s `WDT_MTK` autostart** firing
  as well as with an LK hang ending in LK's watchdog. We cannot tell which yet.
- `last_kmsg` after the loops: `ram console header, hw_status: 2` (MTK: watchdog-type reset, unconfirmed decode).
- Android's image works from either partition through LK directly.
- LK honors BCB, and BCB takes priority over the boot menu. **Never write BCB again without a tested escape.**
- `para` is `/misc` (`/fstab.mt6735`), BCB at offset 0.

**Not known (ranked by how cheaply we can learn it)**
1. **Does U-Boot run invisibly?** The entry band is written to a hard-coded `0x7f7b0000`. LK double-buffers its
   framebuffer; if a different path leaves OVL0 L0 scanning the other buffer, both the band and the console are
   invisible. Then something in U-Boot hangs (or the 15 s WDT fires) before `tbandroid`.
2. **Does LK in the normal path accept any non-stock image in `boot`?** Untested with mainline Linux.
3. What LK does differently between the RTC-recovery path and the BCB-recovery path (both should set
   `g_boot_mode = RECOVERY_BOOT` and load `recovery`).
4. Why Linux sessions ended with `wdt_by_pass_pwk`.

---

## 6. Plan for the next session

### 6.0 Safety rules (from tonight)

1. **Escape first.** Before any layout change, write down how we get back without adb. Order of preference:
   power-cycle → Android; volume menu (hold Vol+ on power-on; Vol+ moves, Vol− selects); LK fastboot +
   `fbusb`; BROM + mtkclient (sudo, in Terminal, Vol+ and Vol− while plugging in).
2. **No BCB writes.** It disables the menu.
3. **Prefer tests that keep Android in `boot`.** Normal-path tests (something else in `boot`) need Android in
   `recovery` and the volume menu confirmed working in that layout first.
4. One hypothesis per flash, but batch all diagnostics into each image (the user is tired of cycles).
5. Record every boot with the camera (frames at 1–2 fps, crop to the tablet) and keep a log in this file.
6. `sudo chown $USER tools/mtkclient/hwparam.json` (it is root-owned after the rescue).

### 6.1 Step 1 — make U-Boot's failure visible (one image, tested via the safe RTC path first)

Build a **diagnostic U-Boot** and verify it in the working RTC path before using it in a failing path:

- Entry (`tb7304x_entry.S`): read `OVL0_L0_ADDR` (`0x14007f40`) and paint the band into **that** buffer as
  well as `0x7f7b0000`. Also paint a second marker at the right edge whose width encodes the path
  (e.g. from `atag,boot` later; at entry just "entered").
- `last_stage_init`: if `L0_ADDR != 0x7f7b0000`, print it and point L0 at `0x7f7b0000` (or move the
  simple-framebuffer base to it). Print LK's bootmode, `boot_reason`, and `/chosen/bootargs` first thing.
- **Watchdog off** in this build (`# CONFIG_WDT_MTK is not set` or no autostart). A U-Boot hang then stays on screen
  instead of looping, and the camera can read it. Escape = long-press power (worked on 2026-11-16 in U-Boot).
- Breadcrumbs: one progress word per stage written to the screen (bands already do this) — and, if a DRAM
  region is found that survives a WDT reset and that preloader/LK don't clear, a magic + stage + timestamp
  there too. (Check first: write a pattern from Android/Linux, WDT-reset, read back.)

Then test this image, in order, stopping at the first that shows the failure:
1. RTC path (control, must work).
2. **Volume-menu "Recovery Mode"** with U-Boot in `recovery` (Android stays in `boot`; safe).
3. Normal path with U-Boot in `boot` and Android in `recovery` (escape: volume menu → Recovery → Android).

Outcomes:
- **Band + text appear and hang somewhere** → it is a U-Boot problem with LK's hand-over state (framebuffer,
  WDT, USB/MMC state). Fix in U-Boot; this is the good case.
- **Nothing appears even with the band painted into L0's current buffer** → LK never jumps. Go to 6.2.

### 6.2 Step 2 — understand LK's paths (no flashing)

- `backup/partitions/lk.bin` + `mainline/scripts/analysis/lk_disasm.py` / `lk_strrefs.py` /
  `mainline/stock/lk.strings`. Find `boot_linux_from_storage`-equivalent, the `g_boot_mode` switch,
  `mboot_recovery_load_misc`, the RTC check, and the kernel jump. Diff what happens between "RTC recovery" and
  "BCB recovery" and "normal" before the jump: image header checks, `mkimg header` handling of the ramdisk,
  DT overlay (`oodtb`/dtbo), size limits, decompression target, cache/MMU teardown, WDT programming.
- Look for an LK log buffer handed to the kernel (MTK "lk log" in DRAM/ram_console). If the stock Android kernel
  exposes it (`/proc/…`, `/sys/kernel/debug/…`), every looping boot can be read back from Android afterwards.
- Hardware option, if LK stays opaque: UART0 test points (LK logs at 921600 8N1, 1.8 V). Definitive, but needs
  opening the tablet.

### 6.3 Step 3 — decide the architecture (see §7), then implement

---

## 7. Do we need U-Boot? Options for the next session

Everything below depends on one fact we don't have yet: **what LK's normal path will boot from `boot`.**
Experiment E2 (mainline Linux image in `boot`, normal power-on, Android in `recovery`, escape via the volume
menu) answers it in one cycle and should be done early.

| Option | Cold-boot default | Android launch | Linux launch | Dev loop | Needs |
|---|---|---|---|---|---|
| **A. Today (Phase 1)** — U-Boot in `recovery` | Android | normal LK | RTC flag → U-Boot → `cache` file or `fastboot boot` | U-Boot `fastboot boot` (RAM, fast) | nothing new; add GUI later |
| **B. U-Boot default** — U-Boot in `boot` | U-Boot → menu/script | `tbandroid` (proven in P1) | U-Boot | same | **fix the LK normal-path hang** (§6.1/6.2) |
| **C. Linux GUI bootloader** — small mainline kernel + initramfs chooser (touch + volume keys) | in `recovery`: Android; in `boot`: chooser | chooser writes RTC flag → reboot → LK boots Android from `recovery` (Android then runs with `ro.boot.mode=recovery`) | `kexec` into the real mainline kernel, or continue into stage 2 | `kexec` from the chooser; flashing via fbusb | E2 must pass for "chooser in `boot`"; verify Android is fully OK in LK recovery mode (modem, charging, WiFi, OTA-irrelevant); `kexec` support in our kernel |
| **D. U-Boot + Linux chooser** | as B | U-Boot | U-Boot → chooser kernel | best | both B's fix and C's GUI |
| **E. Replace LK** | anything | must re-create LK's `atag`/DT handoff | — | — | out of scope (PMIC/display/ATF bring-up) |

Notes for the decision:
- **What U-Boot uniquely gives:** `fastboot boot` from RAM (LK has no `boot` command); booting Android **in
  normal mode** from either partition with LK's DT (`tbandroid` patches bootmode); sub-second start; it is the only
  proven way so far to start Android while something else owns the boot decision.
- **What a Linux chooser gives:** a real GUI (touch, volume keys, the panel driver we already have), `kexec` for
  mainline kernels, scripting in shell, logs in pstore. It **cannot kexec the 3.18 Android kernel** reliably
  (mainline leaves hardware in states the vendor drivers don't expect, and LK's `atag`/DT handoff would need to
  be reproduced), so Android always costs one LK reboot via the RTC flag.
- **Both B and "C with chooser in `boot`" hit the same LK question.** If LK's normal path refuses everything
  but stock images, the only default-capable entry is the RTC flag, which is one-shot (LK clears it), so
  "Linux by default" would need something (Android, or the chooser itself) to re-arm it on every boot.
- C keeps U-Boot optional: U-Boot can stay in `recovery` purely as a developer tool (`fastboot boot`).

Suggested order: §6.1 (one diagnostic U-Boot, three tests) → E2 (mainline in `boot`) → choose B, C or D.

---

## 8. Open items carried over

- Verify on device: `fdt_high/initrd_high` fix (no `failed to reserve memory@78000000`), no `Kernel image
  misaligned` with the 2 MiB offset.
- Diagnose the Linux `wdt_by_pass_pwk` resets (read `/sys/fs/pstore` in Linux after the next one; check whether it
  matches the 300 s `tb-autoreboot`).
- `linux-test.sh to-recovery` / `ml-to-*` semantics changed (recovery is U-Boot now). Update scripts or put
  kernel #24 back in `recovery` if U-Boot is parked.
- Magisk: "Direct install" patches the partition Android booted from. In layout B Android lives in `recovery`;
  check what Magisk targets before updating it.
- Commit `mainline/u-boot/`, `mainline/scripts/fbusb`, this file (not done; the working tree also holds unrelated
  user changes: `STATUS.md` power-off lines, dts, `mtk-rtc-boot-mode.c`, pocketjs, `research-poweroff.md`, 0010
  patch, `plan-boot-recovery.md`).

## 9. Handy commands

```sh
# LK fastboot (from LK menu or `adb reboot bootloader`)
mainline/scripts/fbusb - getvar:product            # sanity
mainline/scripts/fbusb - "oem reboot-recovery"     # boot `recovery` once
mainline/scripts/fbusb <img> flash:<part>          # flash (boot, recovery, …)

# Build U-Boot ($BUILD_HOST = the Docker build machine, $BUILD_DIR = its checkout)
scp mainline/u-boot/* $BUILD_HOST:$BUILD_DIR/mainline/u-boot/
ssh $BUILD_HOST "M=$BUILD_DIR/mainline; docker run --rm -v \$M:/m -v tb7304-ubuild:/uout tb7304-build bash /m/u-boot/build-uboot.sh"
scp $BUILD_HOST:$BUILD_DIR/mainline/out/{u-boot-tb7304x.img,boot-mainline-uboot.img} mainline/out/

# Write a partition from Android (toybox dd has no conv=; verify with cmp)
B=/dev/block/platform/mtk-msdc.0/11230000.msdc0/by-name
adb push img /data/local/tmp/x.img; adb shell "su -c 'dd if=/data/local/tmp/x.img of=$B/recovery bs=1048576; sync; cmp /data/local/tmp/x.img $B/recovery'"

# BROM rescue (Terminal, not `!`): Vol+ and Vol− held while plugging USB
cd tools/mtkclient && sudo PYTHONUNBUFFERED=1 ../venv/bin/python mtk.py w <part> <file>

# Camera frames of the tablet (Mac camera index 0), 1 fps, cropped
ffmpeg -f avfoundation -framerate 30 -video_size 1920x1080 -pixel_format uyvy422 -i 0 -t 120 \
  -vf "fps=1,crop=1300:560:420:520" -q:v 4 out/f%03d.jpg
```
