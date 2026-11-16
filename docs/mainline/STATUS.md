# TB-7304X mainline Linux: status

Last updated 2026-11-16. Kernel 7.0.10 (mt6735-mainline `v7.0.10-mt6735`, 046883c) plus our patches in `mainline/`.
The build, boot and test flow is in [`mainline/README.md`](../../mainline/README.md) and
[`mainline/TEST-PLAN.md`](../../mainline/TEST-PLAN.md).

Research notes (read-only investigations of the stock firmware, mainline tree and datasheets):

| Topic | File |
|---|---|
| Display: D2 address map, panel (NT51021B DJ/GX), DRM bring-up plan | [research-display.md](research-display.md) |
| Charger SM5414, battery ADC, RTC, thermal, I2C inventory, accelerometer | [research-power.md](research-power.md) |
| Root filesystem on the eMMC (Alpine in an image on `cache`) | [research-rootfs.md](research-rootfs.md) |

## Device functionality

| Function | Status | How / notes | Next step |
|---|---|---|---|
| Boot | ✅ works | `recovery` partition via LK `oem reboot-recovery`. `fb_send.py` because stock `fastboot` stalls. Cmdline ≤ 99 chars. | — |
| CPU, 4× A53 | ✅ all 4 cores, hotplug | `mediatek,mt6735-smp` enable-method: PSCI CPU_ON + SPM MTCMOS (`patches/smp_mt6735.c`) | cpufreq (ARMPLL + PMIC VPROC); clock currently whatever LK left |
| Display | 🟡 simpledrm on LK's framebuffer via a DT `simple-framebuffer` that holds the DIS power domain + MM clocks (panel: **NT51021B GX**). D2 addresses fixed in the DTS | `mtk-lk-fb`; `init` unbinds fbcon and sets OVL0 L3 alpha 0 (LK's orange-state overlay) | Real DRM: D2 DT fixes → mutex table → NT51021B panel driver (research-display §5) |
| Backlight | 🟡 left on by LK | Stock uses DISP_PWM at 0x1100e000 (`disp_pwm`), pin probably GPIO69 | Add with the DRM work |
| GPU (Mali-T720 MP1, 450 MHz) | ❌ not enabled | Panfrost supports Midgard T720; needs MFG power domain/clocks, and a KMS display for Mesa | After DRM |
| Touch | ✅ works | Goodix GT9293, i2c1 @0x5d, `goodix,gt911`, IRQ GPIO10, reset GPIO62, VGP1 2.8 V | Ship the config (`goodix_9293_cfg.bin` wait ~20 s, harmless) |
| Buttons | ✅ works | Vol± on the SoC keypad (`mt6779-keypad`), Power on `mt6328-keys` | — |
| USB | ✅ peripheral | Legacy CDC gadget `0525:a4aa` (ECM + ACM), 172.16.42.1, telnet, httpd | Host mode, VBUS/ID detection |
| eMMC | ✅ probes (50 MHz, unused) | `init` never mounts it | Rootfs (research-rootfs) |
| Internet in stage 2 | ✅ via host | `mainline/scripts/tablet-net.sh`: `http-proxy.py` on the host's 127.0.0.1:3128 + `ssh -R`, sets the clock. apk, curl ok; busybox wget https not | — |
| Root filesystem | ✅ Alpine 3.24.4 | ext4 image `/cache/linux/rootfs.img` (256 MB, 20 MB used), loop-mounted by stage 1 (`init`), which falls back to the initramfs after 2 failed tries or with `tb.r=0`. SSH (dropbear, key only) + telnet on 172.16.42.1 | Package installs need a host proxy (`ssh -R`), no RTC → set the date from the host |
| Reboot target | ✅ | `rtc-boot-mode` driver sets LK's RTC flag: mainline → fastboot / recovery (mainline) / Android directly (`linux-test.sh ml-to-*`, `tb-reboot`) | — |
| Panic recovery | ✅ in build6 | `CONFIG_PANIC_TIMEOUT=10` (no cmdline room for `panic=10`) | — |
| Watchdog | ✅ | `mtk_wdt` | — |
| Charger (SM5414, i2c3 @0x49) | ❌ no driver (bus ✅) | LK leaves it charging at **CV 4.35 V**, 700 mA (450 mA input limit), auto-stop off, **safety timer off** (see below). No battery over-temp cutoff without software | Driver with a desk policy (4.10 V, 500 mA, pause > 45 °C); meanwhile a stage-2 boot script could set 4.10 V |
| Battery voltage/temperature | ❌ | MT6328 AUXADC (no mainline driver); NTC = `murata,ncp15xh103` equivalent | ~250-line ADC driver + `ntc_thermistor` + thermal zone |
| RTC | ❌ | MT6328 RTC at 0x4000, mt6323-compatible; `RTC_DRV_MT6397=y` already | MFD cell + DT node (small) |
| SoC thermal | ❌ | Same design as mt8173, different efuse layout | Low priority; PMIC/board thermistors first |
| Accelerometer | ❌ no node (bus ✅) | **Bosch BMA2xx @0x18 on i2c2**, chip ID 0xFA (BMA253/255 family). MC3433 @0x4c not fitted | `bmc150-accel` + DT node (`bosch,bma255`) |
| IOMMU (M4U) | ✅ probes | Binds larbs 0–2 after the D2 address fix and dropping larb3. Display ports not attached yet (MMU_EN = 0) | Attach with the DRM pipeline |
| WiFi / BT / GPS / FM | ❌ | MT6625L via CONSYS/WMT, no mainline driver | Biggest blocker for a networked desk device; USB networking meanwhile |
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

### Other
- `reboot -f` can hang in mainline; `echo b > /proc/sysrq-trigger` works.
- Reading `/sys/kernel/debug/clk/clk_summary` in mainline appears to lock up the tablet (watchdog reset).
  Probably a register read in a powered-off domain. Not confirmed; pstore should have the log.
- Patch 0002 (skip larb port config without IOMMU) may become unnecessary once the larb addresses are fixed.

## Performance expectations
- CPU: 4× Cortex-A53, ~1.0–1.25 GHz, 1 GB LPDDR3. About a Raspberry Pi Zero 2 W / Pi 3. Fine for a terminal,
  daemons, a lightweight Wayland compositor and a custom UI; Chromium/Electron will struggle mainly for RAM.
- No cpufreq yet: the cores run at LK's clock; no thermal throttling yet.
- GPU: Mali-T720 MP1, small (Pi 3 class). Panfrost/Mesa give GLES 2/3, enough for 2D compositing at 600×1024.

## Todo, in order
1. ~~Fix the Android safe-mode boot loop~~ (done: Magisk boot counter, see above).
2. ~~Panic timeout~~ (in build7). The clk_summary lockup left nothing in pstore; avoid reading `clk_summary`.
3. ~~Enable i2c2/i2c3, read SM5414 and accelerometer~~ (done, see above). Add the BMA2xx node.
4. RTC (MT6328).
5. ~~Rootfs~~ (done). Next: an HTTP proxy over `ssh -R` for `apk`, and `apk fix` to run the skipped package scripts.
6. ~~Display D2 DT fixes + IOMMU larb fix~~ (done; a DT simple-framebuffer now keeps the display powered). Next: the NT51021B **GX** panel driver, the D2 mutex table and `DRM_MEDIATEK`.
7. MT6328 ADC + battery NTC + SM5414 driver with the desk charging policy.
8. Backlight, then GPU (Panfrost).
9. cpufreq.
10. WiFi: investigate CONSYS/WMT feasibility.
