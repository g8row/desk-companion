# TB-7304X mainline Linux: status

Last updated 2026-11-17 (kernel #22 on the tablet, #23 built; boot design decided in plan-dualboot.md). Kernel 7.0.10 (mt6735-mainline `v7.0.10-mt6735`, 046883c) plus our patches in `mainline/`.
The build, boot and test flow is in [`mainline/README.md`](../../mainline/README.md) and
[`mainline/TEST-PLAN.md`](../../mainline/TEST-PLAN.md).

Research notes (read-only investigations of the stock firmware, mainline tree and datasheets):

| Topic | File |
|---|---|
| Display: D2 address map, panel (NT51021B DJ/GX), DRM bring-up plan | [research-display.md](research-display.md) |
| Charger SM5414, battery ADC, RTC, thermal, I2C inventory, accelerometer | [research-power.md](research-power.md) |
| Root filesystem on the eMMC (Alpine in an image on `cache`) | [research-rootfs.md](research-rootfs.md) |
| WiFi/BT: MT6625L via CONSYS, prior art and plan | [research-wifi.md](research-wifi.md) |
| Power off, PMIC long-press reset | [research-poweroff.md](research-poweroff.md) |
| U-Boot chainload: what works, the LK normal-path loop, next plan | [handoff-uboot-2026-11-17.md](handoff-uboot-2026-11-17.md) |
| Stock LK disassembled: boot flow, image contract, why U-Boot looped | [research-lk-bootflow.md](research-lk-bootflow.md) |
| **Dual boot, decided design:** U-Boot in `boot`, Android in `recovery`, eMMC layout, GUI, migration, test status | [plan-dualboot.md](plan-dualboot.md) |

## Device functionality

| Function | Status | How / notes | Next step |
|---|---|---|---|
| Boot | ✅ works | `recovery` partition via LK `oem reboot-recovery`. `fb_send.py` / `scripts/fbusb` because stock `fastboot` stalls. Cmdline ≤ 99 chars. Since 2026-11-17 `recovery` holds **U-Boot** (padded image `672f2f9a…`), which RAM-boots Linux (`fastboot boot`, no cmdline limit) or boots Android in normal mode. The "LK normal-path loop" was our image: kernel area < 512 KiB, so LK used a leftover DTB (research-lk-bootflow.md). Fixed and tested: T0 reproduced, T1 passes. Check every LK-bootable image with `scripts/analysis/lk_image_check.py` | **Dual boot live:** `boot` = U-Boot, `recovery` = Android. **Power-on and plain reboots boot Linux** from the raw slot `tbkern_a` (fallback `/cache/linux/boot-mainline-uboot.img`; `tbrescue` after 3 unhealthy boots, then Android; T9). Android: `tb-reboot android` (one-shot, normal mode) or `default-android`. Charger/alarm boots go to Android. **Boot record + U-Boot boot counter:** 3 Linux boots that never reach `healthy` → Android (crash-tested, T7). `linux-test.sh state` shows the record. **Boot menu** in stage 1 (3 s; double-tap or Vol±/Power; ghost touches from the cracked glass are filtered; T8). `fastboot continue` fixed (patch 0002). Repartitioned (§6 done). Next: an updater for the inactive slot (§7) |
| CPU, 4× A53 | ✅ all 4 cores, hotplug, cpufreq 1040–1196 MHz (1144/1196 = overclock, boost) | `mediatek,mt6735-smp` enable-method: PSCI CPU_ON + SPM MTCMOS (`patches/smp_mt6735.c`). cpufreq-dt on ARMPLL + MT6328 VPROC, schedutil; ARMPLL /1 only (see "cpufreq" below) | Idle below 1040 MHz needs a CPU clock mux (park on MAINPLL) to change the post-divider safely; SoC thermal sensor before trusting 1196 MHz long-term |
| Display | ✅ mediatek-drm, 66 Hz | RDMA0 → DSI0 → NT51021B GX (`panel-novatek-nt51021b.c`), D2 mutex table, through the IOMMU. `/dev/dri/card1`; `fb0` = mediatekdrmfb with the kernel console on screen. Refresh measured 66 Hz (kmscube, vsync-locked). (A one-off burst of 10 IOMMU faults at boot, before the first framebuffer is attached.) | Full OVL0 path for hardware planes |
| Backlight | ✅ | `pwm-backlight` on DISP_PWM, `/sys/class/backlight/backlight` (0–255, default 200) | — |
| GPU (Mali-T720 MP1, 450 MHz) | ✅ Panfrost + Mesa 24.3 | `&gpu` from mt6735.dtsi, VCORE1 as mali-supply; `/dev/dri/card0` (render). Mesa built by `mainline/gpu/build-mesa.sh` into `/opt/mesa` (EGL, GLES 2.0, GBM, kmsro). kmscube 66 fps | GPU devfreq/OPPs (runs at LK's 450 MHz); Mesa into the rootfs image |
| Touch | ✅ works, at 1.0 s | Goodix GT9293, i2c1 @0x5d, `goodix,gt911`, IRQ GPIO10, reset GPIO62, VGP1 2.8 V. `FW_LOADER_USER_HELPER` off: its fallback for the optional `goodix_9293_cfg.bin` delayed the device to 62 s | — |
| Buttons | ✅ works | Vol± on the SoC keypad (`mt6779-keypad`), Power on `mt6328-keys` | — |
| USB | ✅ peripheral | Legacy CDC gadget `0525:a4aa` (ECM + ACM), 172.16.42.1, telnet, httpd | Host mode, VBUS/ID detection |
| eMMC | ✅ probes (50 MHz, unused) | `init` never mounts it | Rootfs (research-rootfs) |
| Internet in stage 2 | ✅ via host | `mainline/scripts/tablet-net.sh`: `http-proxy.py` on the host's 127.0.0.1:3128 + `ssh -R`, sets the clock. apk, curl ok; busybox wget https not | — |
| Root filesystem | ✅ Alpine 3.24.4 | **`tbroot_a` (mmcblk0p28, ext4, 2 GiB)**, checked with `e2fsck -p` and mounted by stage 1; `/data` = `tbdata` (2.5 GiB). The old loop image `/cache/linux/rootfs.img` is the fallback (slot `cache`); stage 1 stays in the initramfs with `tb.r=0` or `tb.slot=rescue`. SSH (dropbear, key only) + telnet on 172.16.42.1 | Package installs need a host proxy (`ssh -R`), no RTC → set the date from the host |
| Reboot target | ✅ | `tb-reboot android|linux|android-direct|default-android|default-linux|uboot|bootloader` (boot record via `tbstate`, or LK's RTC flag via `rtc-boot-mode`); host side `linux-test.sh ml-to-*` / `to-linux` / `to-uboot` / `state` | — |
| Panic recovery | ✅ in build6 | `CONFIG_PANIC_TIMEOUT=10` (no cmdline room for `panic=10`) | — |
| Watchdog | ✅ | `mtk_wdt` | — |
| Charger (SM5414, i2c3 @0x49) | ⚠️ no driver, boot-script policy | LK programs **CV 4.35 V**, 700 mA, 450 mA input limit, **safety timer off** on every boot. `local.d/tb-charger.start` sets CV 4.10 V / 500 mA. The chip is autonomous: settings survive unplug, and charging resumes on replug (STATUS 0x22 → 0x42 unplugged → 0x02, measured). No over-temp cutoff, no charger-type detection (input stays 450 mA, which a busy tablet can exceed) | Driver: power_supply class, BC1.2 input current, JEITA pause |
| Battery voltage/temperature | ❌ | MT6328 AUXADC (no mainline driver); NTC = `murata,ncp15xh103` equivalent | ~250-line ADC driver + `ntc_thermistor` + thermal zone |
| RTC | ❌ | MT6328 RTC at 0x4000, mt6323-compatible; `RTC_DRV_MT6397=y` already | MFD cell + DT node (small) |
| SoC thermal | 🔧 kernel #23 built, not tested | `patches/0009`: `mediatek,mt6735-thermal` in auxadc_thermal.c, MT8173 data with 3 banks (CPU TS_MCU3, SoC+GPU TS_MCU1, LTE TS_MCU2). DT: AUXADC @0x11001000, efuse @0x10206000 (calibration cell 0x19c, 12 bytes), thermal @0x1100b000, zone `cpu-thermal` (passive 85 °C → CPU cooling, critical 110 °C). On #22 AUXADC and efuse bind; the thermal driver itself was missing (`CONFIG_MTK_SOC_THERMAL`, added for #23) | Flash #23, check `/sys/class/thermal/thermal_zone0/temp` against a warm/cold tablet |
| Accelerometer | ❌ no node (bus ✅) | **Bosch BMA2xx @0x18 on i2c2**, chip ID 0xFA (BMA253/255 family). MC3433 @0x4c not fitted | `bmc150-accel` + DT node (`bosch,bma255`) |
| IOMMU (M4U) | ✅ probes | Binds larbs 0–2 after the D2 address fix and dropping larb3. Display ports not attached yet (MMU_EN = 0) | Attach with the DRM pipeline |
| WiFi | 🟡 scans | MT6625L via CONSYS: MediaTek's WMT/STP/BTIF + wlan_gen2 (frank-w's 5.15 tree + MT6735 BSP platform layer, ported to 7.0, built in: `mainline/wcn`, patches/0011). `wmt_loader`, `stp_uart_launcher -p /etc/firmware`, `echo 1 > /dev/wmtWifi` → `mt6625_0`, NVRAM MAC, 2.4 + 5 GHz scan works (2026-11-17, RAM boot). Steps in research-wifi.md | Associate (wpa_supplicant), rootfs: firmware + tools + OpenRC service, rename to wlan0, BT/GPS/FM |
| Audio, camera, modem | ❌ | — | Not planned |

## Display step 0 (LK state, read 2026-11-16)
Read with devmem from Alpine while LK's picture was up. Confirms research-display.md:
- `lcmname` = `nt51021b_dsi_vdo_gx`, so this tablet has the **GX** panel variant.
- MUTEX0_MOD `0x14015030` → mod `0x2F940` (bits 6 OVL0, 8 RDMA0, 11 CCORR, 12 COLOR, 13 AAL, 14 GAMMA, 15 DITHER,
  17 PWM) and SOF = 1 (DSI0). This confirms the **D2 mutex table** and that LK runs the full OVL0→…→RDMA0→DSI0 path.
- DSI0: MODE_CTRL = 3 (burst video), TXRX_CTRL = 0x3C (4 lanes), VSA/VBP/VFP = 2/25/35, VACT = 1024,
  HSA/HBP/HFP word counts = 36/284/244. These are the GX timings.
- MMSYS CG_CON0/1 = `0xFFFCB3FC`/`0xFFFFFFF0`.
- MIPI_TX PLL: `0x14018058` = `0x33B13B13`, `+0x50` = 9, `+0x54` = 1.
- larb0 MMU_EN (`0x14016fc0`) = 0: LK scans out with physical addresses.
- DISP_PWM `0x1100e000` EN = 1, `+0x14` = `0x03FF03FF`.
- The GPIO125 level could not be read (it isn't requested in debugfs); `lcmname` makes it unnecessary.

## SM5414 state left by LK (read 2026-11-16, i2c-2 = i2c3 @0x49, read-only)
| reg | value | decode |
|---|---|---|
| 0x00–0x02 INT1–3 | 0x7C 0x25 0x0E | latched events (read-clear): UVLO, VBUSINOK, AICL, VBUSLIMIT, BATOVP; WEAKBAT, CHGRSTF, TOPOFF |
| 0x06 STATUS | 0x22 | TOPOFF + BATDET: battery present, in top-off (near full) |
| 0x07 CTRL | 0x42 | ENCOMPARATOR, CHGEN = 1 |
| 0x08 VBUSCTRL | 0x07 | input limit 450 mA |
| 0x09 CHGCTRL1 | 0x27 | AICL threshold 4.5 V, AICL on, AUTOSTOP off, precharge 450 mA |
| 0x0A CHGCTRL2 | 0x0C | fast charge 700 mA |
| 0x0B CHGCTRL3 | 0xAC | **BATREG 4.35 V**, WEAKBAT 3.6 V |
| 0x0C CHGCTRL4 | 0x0D | top-off current 150 mA, DISLIMIT 5 |
| 0x0D CHGCTRL5 | 0x0F | **FASTTIMER disabled**, top-off timer 45 min |
| 0x0E | 0x43 | chip ID / present |

So under mainline the battery is held at 4.35 V indefinitely, with no timer and no temperature cutoff. That is fine for
sessions, but not for a permanently plugged-in desk device. The stopgap `i2cset -y 2 0x49 0x0b 0x0c` (BATREG 4.10 V,
WEAKBAT unchanged) lasts until the next boot, because LK reprograms the charger every time.

Bus numbers in stage 2: i2c-0 = i2c1 (touch), i2c-1 = i2c2 (sensors), i2c-2 = i2c3 (charger).

## cpufreq (kernel #21)
- OPPs: 1040 / 1092 MHz at 1.25 V; boost (overclock, `local.d/tb-cpu.start` enables it) 1144 MHz at 1.275 V and
  1196 MHz at 1.30 V. Voltages from the stock kernel's MT6737M table (`{kHz, uV/10, uV/10}` triplets at 0xfac558 in
  the stock Image: 1092 MHz at 1.25 V down to 221 MHz at 0.95 V), +25/+50 mV for the overclocks.
- ARMPLL behaviour, measured by writing ARMPLL_CON1 (0x10209204) through `/dev/mem` on the running tablet:
  - pcw (multiplier) changes are safe at any time;
  - post-divider /2 → /1 with the VCO moved first works; **/1 → /2 hangs the SoC** (kernels #18/#19 died this way
    under schedutil). The stock kernel parks the CPU on MAINPLL around such changes; mainline has no CPU mux;
  - pcw writes above ~0xb8000–0xba000 at /1 (≈1.2 GHz), and above VCO ~2 GHz at /2, are dropped; some writes
    get dropped by timing too.
- So every OPP is at /1; the one post-divider change is cpufreq's first step up from LK's 793 MHz. Cost: no idle
  below 1040 MHz. `patches/0007` (PLL_POSTDIV_SAFE: move the VCO before shrinking the divider) and `0008`
  (re-write the pcw until it reads back).
- 1196 MHz: 4-core NEON/scalar cross-check clean (30 s at 1.30 V); a single-core loop is 21 % faster than 988 MHz.
  The PocketJS UI barely changed with it: its frames were memory-bound (see "PocketJS on mainline").
- Stock CPU mux: the stock kernel reads `TOP_CKMUXSEL` bits [3:2] through an ioremapped pointer, but
  infracfg+0x0 (0x10001000) reads 0 on this chip, so the register is elsewhere. Not found yet.
- `patches/0005`: the MT6328 regulator table had VPA's vsel register for VPROC (read 0.6 V; the real
  VPROC_CON11 = 0x58 = 1.15 V at LK's 793 MHz). `patches/0006`: the mt6735 PLLs had no `fmax`, so every
  `clk_set_rate` became 0 Hz (ARMPLL_CON1 = 0x84000000, CPU at a fraction of its clock while cpufreq said 988 MHz).
- VSRAM (LDO, 1.35 V from LK) stays above every VPROC level.

## GPU: Panfrost + Mesa
- Kernel: `&gpu` enabled (`mediatek,mt6735-mali`, `arm,mali-t720`), mali-supply VCORE1 as on the Galaxy Grand
  Prime+. Panfrost: id 0x720, 1 shader core, 1 L2, clock 450 MHz (LK's mfg_sel). card0 = panfrost, card1 = display.
- Userspace: Alpine's `mesa-dri-gallium` needs ~210 MB with LLVM (rootfs has ~170 MB free), so
  `mainline/gpu/build-mesa.sh` cross-builds Mesa 24.3.4 (Panfrost + kmsro only, no LLVM; 24.3 because later
  Panfrost needs mesa_clc on the build host) on taos with Zig, against Alpine's aarch64 packages as sysroot.
  17 MB in `/opt/mesa`; needs `apk add libdrm expat zstd-libs`.
- Pitfalls hit: zig links non-PIE executables without copy relocations for musl's data (getopt loops, getenv
  crashes) → PIE; no ELF build-id → Panfrost's disk cache crashes → `-Dshader-cache=disabled`.
- Result: `Mali-T720 (Panfrost)`, OpenGL ES 2.0 Mesa 24.3.4; kmscube 66 fps, vsync-locked, no kernel errors.

## PocketJS on mainline
- `pocketjs-kiosk` (pocketjs `hosts/android`, static aarch64 musl) runs as the OpenRC service `pocketjs`
  (`mainline/scripts/pocketjs-deploy.sh` builds and installs it). Display through fbdev (`mediatekdrmfb`), touch
  Goodix, keys `mt6779-keypad` + `mtk-pmic-keys`, VT in KD_GRAPHICS. deskd over `ssh -R 7777:127.0.0.1:7777`.
- The landscape UI is rotated 90° into the portrait panel in software (the display engine only does 0/180°).
  Full-frame rotate: 110 ms column walk → 19 ms tiled → 7.6 ms NEON 4×4 (988 MHz).
- Page slides: 8 fps → 33–45 (tiled, real 988 MHz after `patches/0006`) → 51–62 (NEON) → **59–62 fps with even
  pacing** (raster in row bands on scoped threads, rotate on 2 threads, direct writes into the fb). Average
  full-screen frame 10.3 ms. More than 2 threads gains nothing: memory-bandwidth bound.
- DRM/KMS scanout (pocketjs 9db560b, default; `POCKETJS_DISPLAY=fb` for fbdev): card1, two dumb buffers, page
  flip at vblank, buffer reused only after its flip completes, console CRTC restored on exit. Swipes: 60 frames/s
  steady, rotate+present ~7.5 ms, no tearing. Still to do: pace the loop by the flip event (it runs on the 60 Hz
  timer, so it renders 60 of the panel's 66 refreshes); write straight into the dumb buffer if its mapping allows.
- Tools: `/usr/local/sbin/swipe /dev/input/event2 l|r N gap_ms` injects swipes; `POCKETJS_STATS=1|2` per-second /
  per-frame stats; `mainline/scripts/tb.sh` (ssh) and `fb2png.py` (fbdev dumps only, not DRM buffers).

## Cracked glass: phantom touches (2026-11-17)
- Measured with nobody touching (`/tmp/tlog.py` on the tablet, raw Goodix slots): phantom contacts come in bursts.
  First ~1.4/s, 96% starting in panel x 370-470, y 0-125 (landscape left edge, logical x 0-62, y 65-115), plus one
  spot at (7, 118). An hour later a storm of 10-20/s along a line at panel x ≈ 500-530, the full panel length
  (landscape: a strip just under the nav, logical y ≈ 40-55), then nothing at all. Mostly 15-250 ms and stationary;
  some stick for minutes (one held at (497, 32) for > 30 s).
- The framework follows ONE primary contact until it lifts, and a tap fired on lift with no time limit: a stuck
  phantom blocked every real touch (taps on the nav did nothing), and a long phantom hold could press a button.
- Fixes, all in the kiosk host / framework (pocketjs `hosts/android/src/kiosk.rs`, `framework/src/input.ts`), set in
  `/etc/conf.d/pocketjs`:
  - `POCKETJS_TOUCH_MASK`: contacts that START in fixed rects are dropped for their whole life.
  - `POCKETJS_TOUCH_LEARN=1`: 40 px cells that keep producing stationary contacts (score >= 10, 60 s decay) are
    masked until they fall below 2; the moving crack areas are learned at run time. Logged as `touch: cell ...`.
  - `POCKETJS_TOUCH_STALE_MS=3000`: a contact held still for 3 s is hidden until it lifts (`touch: retired ...`).
  - Desk app: `configureTouch({ tapMaxFrames: 60 })`, a press held over 1 s fires nothing.
- Verified: with a stuck phantom present, injected taps on all 8 nav cells switched panes (`/tmp/tap.py`).
  Not yet seen live: the learner during a storm (the storm ended before the deploy).
- UI rule of thumb: keep tap targets off the landscape left edge (x < 64, y 60-120) and the strip under the nav
  (y 35-60); the nav bar itself is clean. Possible real fix: drop the broken sensor channels from the GT9293
  config (`Sensor_CH`/`Driver_CH` maps); risky, not tried.

## Boot time (power-on to the PocketJS UI)
| Stage | Before | Kernel #17+ |
|---|---|---|
| Preloader + LK (`bootprof.pl_t` / `lk_t`) | 4.5 + 9.1 s | same; 5 s of LK is the unlocked "Orange State" warning |
| Kernel to /init | 1.7 s | 0.46 s (#17: no RAID6 benchmark, 612 ms, and no ftrace `trace_eval_sync`, 397 ms) |
| Stage 1 initramfs | 7.3 s | 0.4 s (no colour test with mediatek-drm, wait for usb0 instead of sleeping) |
| OpenRC to the kiosk | ~20 s | ~4 s (`mdev -s` was 11.3 s: `/lib/mdev/persistent-storage` on 51 block devices) |
| Touch | 62 s | 1 s |
| UI usable | ~77 s | ~19 s (ssh ~24 s after a reboot command) |

## Known issues

### Display addresses: D2 die
The mainline `mt6735.dtsi` describes the MT6735 "D1" MMSYS layout. This chip is "D2": there is an OVL1 slot at
0x14008000, so every block after OVL0 is +0x1000 and its SPI +1. Examples: RDMA0 0x14009000, DSI0 0x14012000,
MUTEX 0x14015000, larb0 0x14016000, smi_common 0x14017000, MIPI_TX 0x14018000. Full table in research-display §1.
The `init` display watcher's `larb0=` and `smi=` labels are off by one block (they read MUTEX INTSTA and larb0).

### Android boot loop from Magisk safe mode (fixed 2026-11-16)
After the mainline sessions, Android boot-looped on the boot animation. The cause was our workflow, not mainline:
- Magisk 31.1 counts every boot that doesn't reach boot completion (`bootloop` in `magisk.db`) and enters
  safe mode at 2, which disables every module.
- We left Android with `adb wait-for-device; adb reboot bootloader`. adb answers long before boot completes,
  so the counter reached 10.
- With `tb7304x_strip` disabled, system_server crashes (NPE in `PackageManagerService.adjustCpuAbisForSharedUserLPw`),
  so boot never completed again and the counter never reset.

Fix: counter set back to 0, modules re-enabled. Android boots normally.
Prevention: `mainline/scripts/linux-test.sh to-fastboot|to-recovery` waits for `sys.boot_completed` and resets
the counter before rebooting (TEST-PLAN step 1). The keypad was checked and is innocent: mainline leaves
KP_SEL=0, debounce 0x400 (same as stock), no key bits set.

### U-Boot runs only from LK's RTC-recovery path (open, 2026-11-17)
The same U-Boot image works when LK enters through the RTC "reboot recovery" flag, and loops (LK logo ~25 s,
reset, no U-Boot band) when LK boots it normally from `boot` or through a `boot-recovery` BCB in `para`. The BCB
also disables the volume-key boot menu; recovering needed mtkclient in BROM with sudo. Never write BCB without a
tested escape. Details, matrix and plan: [handoff-uboot-2026-11-17.md](handoff-uboot-2026-11-17.md).

### Other
- `reboot -f` can hang in mainline; `echo b > /proc/sysrq-trigger` works.
- Reading `/sys/kernel/debug/clk/clk_summary` in mainline appears to lock up the tablet (watchdog reset).
  Probably a register read in a powered-off domain. Not confirmed; pstore should have the log.
- Patch 0002 (skip larb port config without IOMMU) may become unnecessary once the larb addresses are fixed.

## Performance expectations
- CPU: 4× Cortex-A53, 1.04–1.2 GHz, 1 GB LPDDR3. About a Raspberry Pi Zero 2 W / Pi 3. Fine for a terminal,
  daemons, a lightweight Wayland compositor and a custom UI; Chromium/Electron will struggle mainly for RAM.
- cpufreq yes; no thermal throttling yet (no SoC thermal driver).
- GPU: Mali-T720 MP1, small (Pi 3 class). Panfrost/Mesa give GLES 2.0 here (Midgard T720), enough for 2D compositing at 600×1024.

## Tablet state at the end of 2026-11-16
- Kernel #22 in `recovery` (thermal driver not built in; #23 is taos `mainline/out/boot-mainline.img`, sha256
  bcbfda96…). PocketJS service running the DRM build. Installed by hand on the rootfs, not in the image yet:
  `/opt/pocketjs`, `/opt/mesa`, `/usr/local/sbin/{peek,poke,swipe,tb-reboot}`, `/etc/mdev.conf`,
  `local.d/{tb-charger,tb-cpu}.start`, OpenRC `pocketjs`, apk `libdrm expat zstd-libs gdb`.
- Kernel #24 in `recovery` since 20:22 (adds #23 thermal, SoC zone reads ~42 °C, plus the power-off work). `poweroff`
  works: on USB it ends in LK power-off charging. #22 hung on `poweroff` and its pmic-keys bug disabled the
  long-press reset. See research-poweroff.md. The rootfs image reported "mounting fs with errors" after the
  battery pull: run e2fsck on it from Android or stage 1.
- Android exits must use `mainline/scripts/linux-test.sh to-recovery` (Magisk boot counter). If a new kernel does
  not come up, LK falls back to Android: write a known-good image to recovery with `su -c dd` from adb, then
  `to-recovery` (done twice on 2026-11-16 with #17).

## Tablet state on 2026-11-17 (after the U-Boot session)
- `boot` = stock Android + Magisk (original, `backup/partitions/2026-11-17/boot-magisk.img`), `recovery` = U-Boot
  (`mainline/out/u-boot-tb7304x.img`, bc5937ad…), `para` original (no BCB). Kernel #24 is **not** in `recovery` any
  more: `adb reboot recovery` lands in U-Boot, which boots Android unless `/cache/linux/boot-target` says
  `target=linux` (`/cache/linux/boot-mainline-uboot.img`) or `target=fastboot` (then `fastboot boot` from the Mac).
- `linux-test.sh to-recovery` / `ml-to-*` assume Linux in `recovery`; update them or put #24 back.

## Protected RAM at 0x5e700000 (found and fixed 2026-11-17)
- Copying the root into `tbroot_a` crashed userspace: random segfaults (busybox applets, dropbear, pocketjs), then
  the shell lost even `echo`. Files on the eMMC were fine (the same md5 after a reset); page-cache copies were not.
- `mainline/scripts/analysis/memtest.c` (pattern write/verify over ~all free RAM, physical addresses from
  `/proc/self/pagemap`) found exactly **0x5e700000..0x5fffffff (25 MiB)** bad: always reads 0, writes dropped, from
  the first pass, the same range on every boot, everything else clean. That behaviour matches an EMI MPU region
  set up by the boot firmware (preloader/LK/ATF; who and why not determined). The kernel had it as free RAM, so
  any page landing there (in practice only under memory pressure, e.g. a large copy) silently became zeros.
- Fix: `memory@5e700000` no-map in `dts/mt6737m-lenovo-tb7304x.dts`. After it: 720 MiB for 60 s on 4 threads,
  0 errors. `apk audit --system` on the root found no damaged package files from earlier sessions.
- This affected every mainline boot before the fix (LK-direct ones probably too). Files written in earlier
  sessions outside apk (`/opt/mesa`, `/opt/pocketjs`, hand-made configs) were not verified.
- Open: whether other LK boot modes protect other ranges, and what the mainline dtsi's `memory@78000000`
  (77 MiB, from the Doogee board) really covers here.

## Repartitioning (2026-11-17)
- New GPT is on the eMMC (plan-dualboot.md §2 and §6 step 3): `userdata` is 3072 MiB, `mmcblk0p24`–`p30` =
  tbstate, tbkern_a/b, tbrescue, tbroot_a/b, tbdata. §6 step 4 (the `userdata` wipe, Magisk re-setup) is done.
- §6 steps 5–6 done the same evening: record in `tbstate`, kernel in `tbkern_a` + `tbrescue`, root on `tbroot_a`,
  `tbdata` on `/data` (plan-dualboot.md §6, T9). `tbkern_b`/`tbroot_b` are empty (b is formatted).
- The Alpine root's `authorized_keys` now also holds the MacBook's key (it only had the build host's).

## Todo, in order
0. Boot path: follow handoff-uboot-2026-11-17.md §6 (diagnostic U-Boot, LK path analysis, decide U-Boot vs a Linux chooser).
1. ~~Fix the Android safe-mode boot loop~~ (done: Magisk boot counter, see above).
2. ~~Panic timeout~~ (in build7). The clk_summary lockup left nothing in pstore; avoid reading `clk_summary`.
3. ~~Enable i2c2/i2c3, read SM5414 and accelerometer~~ (done, see above). Add the BMA2xx node.
4. RTC (MT6328).
5. ~~Rootfs~~ (done). Next: an HTTP proxy over `ssh -R` for `apk`, and `apk fix` to run the skipped package scripts.
6. ~~Display: D2 DT fixes, IOMMU, NT51021B GX panel driver, D2 mutex table, mediatek-drm~~ (done). Next: the OVL0 path (hardware planes).
7. MT6328 ADC + battery NTC + SM5414 driver with the desk charging policy.
8. ~~Backlight~~, ~~GPU: Panfrost + Mesa~~ (done). Next: GPU OPPs; Mesa in the rootfs image.
9. ~~cpufreq, 1092 MHz, overclock to 1196~~ (done). SoC thermal: flash and verify kernel #23.
10. ~~PocketJS on DRM/KMS with page flips at vblank~~ (done). Next: pace by the flip event (66 fps).
11. WiFi: scans (research-wifi.md "Bring-up"). Next: associate, put firmware/tools/service into the rootfs.
12. Rootfs image rebuild with everything installed by hand so far (mdev.conf, tb-reboot, local.d scripts, pocketjs service, apk libdrm/expat/zstd-libs, gdb).
