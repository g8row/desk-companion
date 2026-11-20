# TB-7304X boot, recovery and dual-boot plan

**Status:** historical. This was a proposal, not implemented as written; it is superseded by
[docs/mainline/plan-dualboot.md](docs/mainline/plan-dualboot.md). U-Boot is in `boot`, Android in `recovery`, and
Linux boots by default.
**Date:** 2026-11-16.
**Scope:** boot selection, recovery, a possible U-Boot port, rootfs durability, and a boot GUI.
**Out of scope:** kernel drivers (WiFi, charger, thermal), Android app internals, and package work inside Alpine.

> **Results, 2026-11-17** ([docs/mainline/handoff-uboot-2026-11-17.md](docs/mainline/handoff-uboot-2026-11-17.md)):
> Phase 2 (U-Boot chainloaded from `recovery`) works through the RTC flag, including `fastboot boot` of mainline
> and booting Android from `boot` with LK's DT (`tbandroid`, contrary to §7.9's "not recommended"). Putting U-Boot
> in `boot` (Phase 4) and the BCB transport (§3.3) both **failed**: LK loops on its logo. LK does honor BCB, and a
> BCB disables the volume-key menu; recovery needed BROM. Do not write `para` again without a tested escape.
>
> **Superseded in part, 2026-11-17** by [docs/mainline/plan-dualboot.md](docs/mainline/plan-dualboot.md), after
> disassembling LK ([research-lk-bootflow.md](docs/mainline/research-lk-bootflow.md)):
> - The Phase 4 failure was **our image**, not LK. Its kernel area was < 512 KiB, so LK could not load the DTB from
>   the partition and booted with a leftover DTB in RAM. The padded image boots (T1).
> - **U-Boot now goes in `boot`** (Linux by default), and Android in `recovery`.
> - **BCB is rejected permanently** (§3.3, decision 6): LK never clears it, and it hides the volume menu.
> - **The ledger is a raw `tbstate` partition**, not the `recovery` tail (§5.4).
> - **GUI (§8.2):** the RTC recovery bit now means **Android**, so the stage-1 menu must not set it on
>   "Continue Linux". The menu's actions are in plan-dualboot §5.
> - **Rootfs (§9):** no microSD. Raw kernel slots A/B/rescue and ext4 roots A/B are carved from `userdata` on the
>   internal eMMC (plan-dualboot §2).

Companion documents: [STATUS.md](STATUS.md) (current device state), [research-rootfs.md](research-rootfs.md)
(the cache/loop-image design), [TEST-PLAN.md](../../mainline/TEST-PLAN.md) (the tested boot flow),
[ONBOARDING.md](../ONBOARDING.md) (BROM, backups, Magisk).

---

## 0. The answer in one page

The tablet **does** boot both Android and mainline Linux today, but it is **not a dual-boot system**. It is a
one-shot flash handoff:

1. Android runs from `boot` (with Magisk).
2. Mainline runs from `recovery`, because stock LK has no `fastboot boot` and cannot load a kernel from RAM.
3. "Boot Linux next" is a bit written into the MT6328 RTC (`RTC_PDN1`). LK reads it, clears it, and boots
   `recovery` once. The next boot is Android again unless something writes the bit again.

That works, but it is fragile for three separate reasons. U-Boot is useful, but it does not fix any of them by
itself:

| Problem | Today | Why it feels hacky |
|---|---|---|
| **Intent** | A hidden one-shot bit in a PMIC register, written by a shell command or `adb reboot recovery`. No record of who asked, or why. | The user cannot see or audit the request. Cold boot always goes to Android. There is no GUI. |
| **State** | No boot ledger. Nothing records which kernel/rootfs was tried, how many times, whether it reached userspace, or why LK fell back to Android. | A failure looks like "it booted Android again". The only evidence is a serial log if you happened to be attached. |
| **Media** | Rootfs is an ext4 **loop file inside Android's `cache`**. Updates delete the old image before the new one is verified. There is no fsck in the initramfs. Cache can be wiped by Android recovery or a factory reset. | It is not a durable OS installation. It is a guest image sharing Android's scratch space. |

The recommendation is therefore **not** "replace LK with U-Boot". It is:

1. **Make boot intent and boot state first-class.** Introduce a small, checksummed, two-copy **boot ledger**. It is
   a raw record in the unused tail of `recovery` (later on microSD), so U-Boot never writes to Android's ext4
   (section 5.4). The RTC bit — and BCB, if LK proves to honor it — become *transports* for
   the next-boot request; the ledger is the source of truth.
2. **Add an early GUI chooser in the stage-1 initramfs.** It runs about a second after the kernel, before the
   rootfs, and can select Linux, Android, fastboot, or rescue with touch or the volume keys. This is the robust GUI;
   a PocketJS tile is only a convenience for switching while Linux is already running.
3. **Build U-Boot, but chainload it from `recovery`.** U-Boot gives us `fastboot boot` (RAM-only kernel testing),
   a full kernel command line, loading a kernel/initrd from `cache` or microSD, and a place for a boot script. It
   does **not** make Linux the cold-boot default while LK remains the first stage. Keep stock LK and Android's
   `boot` partition untouched.
4. **Move the rootfs to microSD when the boot path is stable.** A FAT boot partition plus A/B ext4 root partitions
   removes the cache-size limit, the double journaling, the Android cache wipe risk, and the non-atomic update.
   This is a separate project from U-Boot and should not block Phase 1.

**U-Boot verdict:** yes, build it, as a **second stage in `recovery`**, after the current path is instrumented and
hardened. Do not replace stock LK yet. Do not put U-Boot in `boot`. Do not enable U-Boot's `fastboot flash` until
the port is proven.

**GUI verdict:** the stage-1 initramfs chooser is the primary GUI. U-Boot's text menu is a later fallback, because
the current U-Boot port has no display or keypad drivers. A PocketJS boot tile is useful but not sufficient: it only
exists after Linux has already booted.

**The one rule:** *the ledger is the source of truth; RTC/BCB are transports.* Every boot decision must be
reconstructible from a file, not from a bit that LK clears.

### Decision summary

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| 1 | Keep stock LK as the first stage | Replace `lk` with U-Boot or a custom LK | Lowest brick risk; Android keeps its known-good boot path; LK already boots AArch64. |
| 2 | Chainload U-Boot from `recovery` | Flash U-Boot to `boot` or `lk` | `recovery` is backed up and one-shot; `boot` holds Android + Magisk. |
| 3 | Ledger as a raw record in the `recovery` tail, then microSD | RTC bits only; U-Boot env; text file on `cache` written by U-Boot | RTC is one-shot and invisible; U-Boot env is not persistent in this port; U-Boot's `ext4write` is delete+recreate on Android's filesystem. |
| 9 | A hardware watchdog covers every stage before `healthy` | Rely on `panic=10` and a long press | A hang (not a panic) otherwise never resets, so no counter ever advances. |
| 4 | GUI in stage-1 initramfs | GUI only in Android or PocketJS | Available before the rootfs, works when the rootfs is broken, ~1 s after kernel. |
| 5 | Android remains the cold-boot default until Phase 4 | Linux default immediately | A power loss or bad update must still leave a usable tablet. |
| 6 | BCB is read-only until proven | Write `boot-recovery` to `para` now | Whether this LK honors BCB is unverified; `para` is Android's. |
| 7 | microSD for the long-term rootfs | Grow the cache image | Cache is Android's scratch space and too small; SD is removable and repairable on a PC. |
| 8 | U-Boot is a Linux loader, not an Android loader (initially) | Boot Android from U-Boot | Android's kernel expects LK's MTK boot arguments; a reset back to LK normal is safer. |

---

## 1. Current state

### 1.1 Boot chain

```
BootROM
  └─ preloader            (not touched; BROM recovery available)
      └─ LK               (stock, ARM32/Thumb-2, no fastboot boot)
          ├─ normal  ───► boot       Android 7 + Magisk
          ├─ recovery ─► recovery   mainline 7.0.10 kernel + DTB + initramfs   ← one-shot via RTC
          └─ fastboot ─► LK fastboot (fb_send.py; stock fastboot download stalls)

mainline kernel
  └─ stage-1 initramfs (mainline/initramfs/init)
      ├─ USB gadget: ACM shell, ECM 172.16.42.1, telnet, http
      ├─ mounts cache, loop-mounts /cache/linux/rootfs.img
      └─ switch_root ─► Alpine 3.24 (stage 2) ─► PocketJS kiosk
```

The current kernel and initramfs live in `recovery` (16 MiB). The rootfs is a 256 MB ext4 image file at
`/cache/linux/rootfs.img` (Android's path). Stage 1 finds `cache` by GPT `PARTNAME`, mounts it at `/mnt/cache`,
loop-mounts the image, and `switch_root`s, moving the cache mount to `/mnt/cache` in the new root. Stage 2
(`/etc/local.d/tb-autoreboot.start`) marks the boot good after 60 s by writing `0` to `/mnt/cache/linux/bootcount`.
After 2 bad boots in a row, stage 1 stays in the initramfs shell, and the 300 s autoreboot then returns to Android.

**Path convention in this document:** `/cache/linux/...` is the Android path. Linux (stage 1 and stage 2) sees the
same files at `/mnt/cache/linux/...`. U-Boot sees them at `/linux/...` on the cache partition.

### 1.2 How switching works today

| From | Command | Mechanism | Result |
|---|---|---|---|
| Android | `linux-test.sh to-recovery` (never a bare `adb reboot recovery`; see F10) | The stock MTK kernel's reboot handler is believed to set the RTC recovery bits; Android may also write its BCB | Mainline, if the one-shot path works |
| Android | `adb reboot bootloader` | LK fastboot | Fastboot |
| Linux | `tb-reboot recovery` | Writes `RTC_PDN1` recovery bits, sysrq `s,u,b` | Mainline again |
| Linux | `tb-reboot android` | Clears the RTC bits, sysrq `s,u,b` | Android |
| Linux | `tb-reboot bootloader` | Sets `RTC_PDN1` bit 13, sysrq `s,u,b` | LK fastboot |
| Linux | `mainline/scripts/linux-test.sh ml-to-*` | Same as `tb-reboot`, over telnet | Same |

The RTC bits are verified in the `lk.bin` disassembly and in `mainline/patches/mtk-rtc-boot-mode.c`: bit 13 =
fastboot, bits 4–5 = `0x10` = recovery. LK reads and clears them when it acts on them.

### 1.3 Why it is unreliable

| ID | Failure | Cause | Current recovery |
|---|---|---|---|
| F1 | Boots Android "for no reason" | The RTC bit was never set, was cleared by LK, or was lost | Hold Power, try again; no diagnosis |
| F2 | Cannot tell whether Linux was tried | No ledger; the bit is gone after LK reads it | Serial log if attached; otherwise nothing |
| F3 | Cold boot always Android | LK's normal path is the default; no persistent "Linux default" | Manual command from Android/Linux |
| F4 | No GUI at power-on | Switching needs a shell; PocketJS has no boot tile | Terminal |
| F5 | Rootfs update can destroy the working image | `init` does `rm -f $IMG` **before** gunzip/verify (`mainline/initramfs/init:184–191`) | Re-push the image from a host; no on-device copy |
| F6 | Cache can be wiped | Android recovery "wipe cache", factory reset, low-space cleanup | Reinstall rootfs from host |
| F7 | No fsck after an unclean shutdown | The initramfs has no `e2fsck`; the loop image's journal is the only protection | e2fsck from a host, or reinstall |
| F8 | A bad kernel/DTB never reaches stage 1 | The bootcount is only incremented by stage 1, so it cannot count a kernel that dies earlier | LK falls back to Android because the request is one-shot |
| F9 | A bad U-Boot can loop, but only after it starts | LK clears the RTC bit when it enters `recovery`. A corrupt U-Boot that never runs leaves the bit clear, so the next reset boots Android. A U-Boot that starts, re-arms the RTC, and then hangs can loop until the ledger limit. | Ledger attempt limit; LK fastboot, key combo, or BROM |
| F10 | Magisk safe mode / Android boot loop | Rebooting Android before `sys.boot_completed` increments Magisk's counter | `linux-test.sh` waits and resets it; manual `magisk --sqlite` |
| F11 | Testing a kernel requires writing `recovery` | LK has no `fastboot boot`; stock `fastboot download:` stalls | `fb_send.py`, flash + `oem reboot-recovery` |
| F12 | Power loss during a flash/update | Recovery or rootfs can be left half-written | BROM/mtkclient; known-good image |
| F13 | Low battery during a long Linux session | At the time there was no charger driver; LK programmed a 4.35 V/700 mA policy with the safety timer off | Historical: the SM5414 driver is implemented and charges at 4.10 V/500 mA (STATUS.md) |
| F14 | Timestamps are wrong | No mainline RTC driver; clock starts at 1970 | Set the date from the host |

The important pattern: **F1–F4 and F8 are state/selection problems, not rootfs problems.** Moving the rootfs to
microSD (F5–F7, F12) is worthwhile but would not fix the switching experience by itself.

---

## 2. What "robust" means

### 2.1 Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| R1 | Android must always remain bootable | `boot`, `lk`, `seccfg`, GPT, `userdata`, `metadata`, `nvdata`, `protect*` are never written by this plan (except `recovery`, intentionally). A cold boot with no SD and no cache still reaches Android. |
| R2 | Every boot decision is explicit and observable | A human can read target, generation, attempt, last result, and last error from Android or Linux. |
| R3 | One-shot intent plus a persistent default | The next boot can be requested from either OS; the default survives reboots and is recorded in the ledger. |
| R4 | Bounded retries | After N failed attempts the system selects Android or rescue; it never loops without a manual escape. |
| R5 | Crash and power-loss safe | Atomic ledger writes and two copies; a power loss at any point leaves a bootable state. |
| R6 | Recovery is independent of the rootfs | LK fastboot, U-Boot fastboot, BROM, and a known-good recovery image work even if cache/SD/rootfs is corrupt. |
| R7 | The GUI is early and optional | A chooser appears within ~1 s of kernel start, times out in 5 s, works with touch and volume keys, and can be disabled with `tb.menu=0`. |
| R8 | No wall-clock dependency | Sequence numbers and uptime, not timestamps, drive the state machine. |
| R9 | Deterministic timing | Bounded menu timeout, watchdog timeout, and boot attempts. No unbounded `sleep`. |
| R10 | Testable | Every state transition has a fault-injection test (section 11). |
| R11 | Reversible | Each phase has a rollback path and a known-good image. |
| R12 | Battery-safe | Low battery or charger failure selects Android/charge, not a long Linux session. |

**R12 caveat:** the mainline kernel has no charger or battery driver yet (section 3.1), so "low battery" is not
observable today. LK does have a hard floor: it refuses to boot any kernel below its cutoff voltage (CLV), so a
nearly empty battery stops in LK, not in a Linux retry loop. Phase 1 can read the SM5414 status over i2c as a coarse check, but a real policy waits for the
power driver. Until then the autoreboot timer and a charged battery are the safety net; do not claim R12 is met.

### 2.2 Invariants

These must hold at every phase:

1. **LK is immutable in this plan.** No writes to `lk`.
2. **`boot` is immutable.** Android + Magisk stay in `boot`.
3. **`recovery` is disposable.** It can be reflashed from LK fastboot, Android `dd`, U-Boot fastboot, or BROM.
4. **The ledger is written before the reboot, not after.** A request that is not on disk did not happen.
5. **The RTC bit is only a request to enter the second stage.** It is never the only record of intent.
6. **A failed boot is counted by whoever starts it.** Stage 1 counts in Phase 1; U-Boot counts in Phase 2. Never both.
7. **The default target is Android until Phase 4.** A crash or power loss must not strand the tablet in a Linux retry loop.
8. **No unbounded retry.** `max_boot_attempts` and `max_trial_attempts` are finite and recorded.
9. **No unbounded hang.** Every stage before `healthy` runs under a hardware watchdog or a deadline (section 5.8).
10. **U-Boot never writes a filesystem on eMMC.** It reads `cache` and writes only the raw ledger record and the RTC.

---

## 3. Boot-chain primer: what is verified

### 3.1 Fact table

| Fact | Value | Evidence | Confidence |
|---|---|---|---|
| SoC / RAM | MT6737M (MT6735 family), 1 GiB | `STATUS.md`, stock DTB | ✅ verified |
| Boot chain | BootROM → preloader → LK → `boot`/`recovery` | stock firmware, `mainline/README.md` | ✅ verified |
| LK architecture | ARM32 / Thumb-2, linked at `0x41E00000`, position-independent | `mainline/README.md` §LK | ✅ verified from `lk.bin` |
| LK `fastboot boot` | Not registered | disassembly of `lk.bin` command table | ✅ verified; untested on device |
| LK fastboot download | Stalls with the stock `fastboot` tool; `fb_send.py` works | `TEST-PLAN.md` | ✅ verified on device |
| LK cmdline limit | ~99 characters | first-boot truncation | ✅ verified on device |
| `recovery` size | 16 MiB | backups / GPT | ✅ verified |
| LK gunzip limit | `0x1C00000` = 28 MiB decompressed | `lk.bin` @ `0x41e1f5c8` | ✅ verified |
| LK RTC boot mode | `RTC_PDN1` bit 13 = fastboot, bits 4–5 = recovery (`0x10`) | `mtk-rtc-boot-mode.c`, `lk.bin` | ✅ verified; LK clears the bits |
| LK BCB support | Probably yes: `lk.bin` contains `mboot_recovery_load_misc`, `boot-recovery`, and the partition names `para`/`misc` | `strings backup/partitions/lk.bin` | ⚠️ likely; not tested on device |
| `para` contents today | First bytes all zero (no pending BCB command) | `backup/partitions/para.bin` | ✅ verified (backup copy) |
| LK boot-menu key combo | Menu exists (`Select Boot Mode:`, `[VOLUME_UP to select.  VOLUME_DOWN is OK.]`); the key combo is unknown | `lk.bin` strings, `TEST-PLAN.md` | ⚠️ menu verified; combo unverified |
| LK power-off charging (KPOC) | Present (`Kernel Power Off Charging Detection`, `oem off-mode-charge`) | `lk.bin` strings | ✅ present; the trigger order relative to the RTC check is unverified |
| LK low-battery gate | LK refuses to boot any kernel below the cutoff voltage (`battery voltage <= CLV ! Can not Boot Linux Kernel`) | `lk.bin` strings | ✅ present; threshold unknown |
| LK / U-Boot fastboot USB IDs | LK `0bb4:0c01`; U-Boot `0e8d:201c` | `TEST-PLAN.md`, grandpplte defconfig | ✅ verified; the Phase 2 spike can tell them apart |
| Android `boot` | Android 7 + Magisk 31.1, FDE `userdata` | `STATUS.md`, `research-rootfs.md` | ✅ verified |
| Android A/B slots | None | `fstab.mt6735`, GPT names | ✅ verified |
| `cache` role | Android scratch; safe writable place today | `research-rootfs.md` | ✅ verified |
| `userdata` | Force-encrypted; Linux cannot decrypt | `fstab.mt6735` | ✅ verified |
| Mainline kernel | 7.0.10, `mt6735-mainline`, commit `046883c` | `mainline/README.md` | ✅ verified |
| Mainline display | `mediatek-drm`, 600×1024, NT51021B GX | `STATUS.md` | ✅ verified |
| LK framebuffer | `0x7f7b0000`, 600×1024, pitch 2432, top 16 MiB reserved | `STATUS.md`, `mtk-lk-fb.c` | ✅ verified |
| ATF reserved | `0x43000000` + `0x30000` | stock DTS, build check | ✅ verified |
| pstore / ram_console | `0x43f10000` + `0xe0000`; `0x43f00000`, `0x43ff0000` | board DTS | ✅ verified |
| U-Boot port | `gitlab.com/mt6735-mainline/u-boot`, branch `mt6735-staging`, commit `3d74bf16`, U-Boot **2023.04-rc1** | local clone / `Makefile` | ✅ verified |
| U-Boot target | `TARGET_MT6735` selects `ARM64`; grandpplte defconfig is a non-SPL payload | `arch/arm/mach-mediatek/Kconfig`, defconfig | ✅ verified |
| U-Boot text base | grandpplte `CONFIG_TEXT_BASE=0x40008000` | defconfig | ✅ verified |
| LK kernel alignment | `kernel_addr & 0x7FFFF == 0` (512 KiB) | `lk.bin` disassembly | ✅ verified |
| U-Boot fastboot boot | `fastboot boot` runs `bootm` / `fastboot_bootcmd`; unlike LK | `drivers/fastboot/fb_common.c` | ✅ verified in source; untested on device |
| U-Boot display | no video/I2C driver in grandpplte defconfig; `DM_KEYBOARD=y` (uclass only) but no MTK keypad driver in `drivers/input`; `VIDEO_SIMPLE` exists | defconfig, `drivers/video`, `drivers/input` | ✅ verified |
| U-Boot BCB | `CONFIG_CMD_BCB` exists but is not enabled | `cmd/Kconfig` | ✅ verified |
| U-Boot env | no persistent `ENV_IS_IN_*` backend in grandpplte defconfig | defconfig | ✅ verified |
| U-Boot RTC writes | The MT6328 driver implements only `read_u32`/`write_u32`, no byte `read`/`write`. So `pmic read`/`pmic write` return `-ENOSYS`; they fail, they do not corrupt. `pmic_clrsetbits()` already does a 16-bit read-modify-write through `read_u32`/`write_u32`. | `pmic_mt6328.c`, `pmic-uclass.c` | ✅ verified in source |
| U-Boot ext4 write | `CONFIG_EXT4_WRITE=y` already. `ext4write` **deletes and recreates** an existing file (not in place). It refuses `metadata_csum` filesystems and hash-tree (`dir_index`) directories. | `fs/ext4/ext4_write.c` | ✅ verified in source |
| U-Boot watchdog | `CONFIG_WDT=y` but `WDT_MTK` is off. The DT has `mediatek,mt6589-wdt` @ `0x10212000`, which `mtk_wdt.c` matches. The driver clamps the timeout to **15.98 s**. | defconfig, `mt6735.dtsi`, `mtk_wdt.c` | ✅ verified in source |
| U-Boot `booti` placement | `booti` moves the Image to a **2 MiB-aligned** base + `text_offset` (0 on 7.0), so a kernel loaded at `0x40080000` runs from `0x40200000` | `arch/arm/lib/image.c` | ✅ verified in source |
| U-Boot partition names | `ext4load mmc 0:<n>` needs a number; `mmc 0#name` works only in `part_get_info_by_dev_and_name_or_num()` callers, not in `fs` commands. `part number mmc 0 cache var` exists. | `disk/part.c`, `cmd/part.c` | ✅ verified in source |
| microSD | `msdc1` @ `0x11240000`, 4-bit, card-detect GPIO 11 | stock DTS | ✅ verified; no mainline/U-Boot test yet |

### 3.2 The RTC mechanism in detail

`mainline/patches/mtk-rtc-boot-mode.c` exposes:

```
/sys/devices/platform/rtc-boot-mode/next_boot
```

Writing `bootloader`/`fastboot` sets bit 13; `recovery` sets `0x10` in bits 4–5; `normal`/`android` clears both.
It then writes `RTC_WRTGR` and waits for `RTC_BBPU.CBUSY` to clear. The bits live in the RTC domain, which is powered separately from the SoC (main battery/coin cell), so they
normally survive a power-off; they do **not** survive a fully drained or disconnected battery. **LK clears them
when it acts on them**, which is why the current mechanism is one-shot.

Two consequences:

- A crash or power loss after LK consumed the bit returns to Android. That is a useful safety property.
- To stay in Linux across reboots, Linux must write the bit again after a healthy boot or before every reboot.
  That is what `tb-reboot` does. It is also why "Linux stayed up for 3 days, then a power cut booted Android" is
  expected, not a bug.

### 3.3 BCB, and why it is not the answer

Android's bootloader control block lives in `para` (the `misc` partition). The standard layout starts with a
32-byte `command` field; `boot-recovery` asks the bootloader to enter recovery. Standard Android writes it when
recovery requests a reboot, and some bootloaders also use it for `adb reboot recovery`.

On this MTK device, however, the stock kernel's reboot handler is believed to write `RTC_PDN1` for
`reboot recovery` / `reboot bootloader` — that is exactly the behaviour `mtk-rtc-boot-mode.c` mirrors. So the
current Android → mainline path may be the RTC path, not BCB. The `lk.bin` strings (`mboot_recovery_load_misc`,
`boot-recovery`, `para`, `misc`) match stock MTK LK's `recovery.c`, which reads the BCB from `misc` and enters
recovery on `boot-recovery`. So this LK **probably** honors BCB, but we have not tested which mechanism a given
reboot uses. Even if it does, BCB is only another one-shot transport:
it does not record attempts, generations, or why a boot failed. The plan therefore treats BCB as:

- **read-only** in Phase 0 (log it before and after `adb reboot recovery`);
- an optional **secondary transport** if the test shows LK honors it;
- never the source of truth.

Do not write `para` until the read-only test is understood and a full backup exists.

### 3.4 What U-Boot is, and is not

The MT6735 U-Boot port is a real AArch64 U-Boot derived from the Samsung Galaxy Grand Prime+ work. It is a
**payload**, not an SPL: the grandpplte defconfig has no SPL, `TEXT_BASE` at `0x40008000`, and a boot command that
sources a script from `0x44000000`. It has:

- eMMC (`MMC_MTK`), ext4/FAT/squashfs, `CMD_BOOTMENU`, `CMD_BOOTI`/`CMD_BOOTZ`, `CMD_GPT`/`CMD_PART`;
- MUSB gadget fastboot and mass storage, MT6328 PMIC/regulators (the RTC driver is built, but the grandpplte DTS
  does not instantiate it), MTK watchdog;
- no video, no I2C, no keypad driver, no BCB command enabled, no persistent environment;
- `CONFIG_ANDROID_BOOT_IMAGE` explicitly **off** in the grandpplte defconfig (we will turn it on for
  `fastboot boot` compatibility, not to boot Android).

It is **not** a replacement for LK in this plan. It cannot currently drive the panel or read the keys, and it does
not replicate LK's MTK `atag`/`bootopt` handoff to the Android kernel. It is a Linux loader and a fastboot server.

### 3.5 The alignment trap

Our LK checks `hdr->kernel_addr & 0x7FFFF == 0`, i.e. the boot image's kernel load address must be 512 KiB
aligned. The grandpplte U-Boot is linked at `0x40008000`, which is only 32 KiB aligned. LK would reject a boot
image with that `kernel_addr` ("64 bit kernel can't boot at …"). Even if LK accepted it, the link address would
not match.

**Therefore the TB-7304X U-Boot must be rebuilt with `CONFIG_TEXT_BASE=0x40080000`** (or another 512 KiB-aligned
address that does not collide with the kernel load area), and packaged with `mkbootimg --kernel_offset 0x00080000`.
U-Boot is position-independent (`CONFIG_POSITION_INDEPENDENT=y`), but relying on PIC to fix a 480 KiB link-address
mismatch is unnecessary risk. This is a concrete porting change, not a config preference.

---

## 4. Options considered

| Option | What changes | Solves | Does not solve | Risk | Effort | Verdict |
|---|---|---|---|---|---|---|
| **A. Status quo + scripts** | nothing structural | switching from Linux; fastboot access | intent, ledger, GUI, media | low | — | keep as fallback |
| **B. BCB / `para`** | write Android's BCB | an OS-neutral next-boot request | LK support unverified; no ledger; no GUI | medium (writes Android's partition) | low | probe read-only; secondary transport |
| **C. Chainload U-Boot from `recovery`** | `recovery` = U-Boot; kernel/initrd on cache/SD | `fastboot boot`, full cmdline, SD boot, boot script, U-Boot menu later | cold-boot default; media; needs a ledger for fallback | medium | medium | **recommended Phase 2** |
| **D. U-Boot as primary (`lk`)** | replace LK with U-Boot | Linux default, one boot manager, real menu | Android boot integration, display/keys, ATF handoff; BROM only recovery | high | high | only Phase 4, optional |
| **E. Custom LK** | modify/replace `lk` | full control of boot menu and BCB | maintenance, signed/firmware quirks, brick risk | very high | very high | no |
| **F. `kexec` from Android/Linux** | kexec a kernel from the running OS | fast switch without reboot firmware | needs kernel support and root; no early boot; Android's kernel has no kexec | high | medium | no |
| **G. `bootshim`** | wrap U-Boot in a Linux-Image-like stub | LK compatibility if it rejects a raw payload | nothing else | low | low | only if the Phase 2 spike fails |

### A. Status quo + scripts

This is what exists. It is not worthless: it proves the RTC handoff and gives a reliable manual path. Keep the
scripts and the RTC driver. The plan hardens around them, not replaces them.

### B. BCB

Worth a read-only experiment because it is the standard Android contract. If LK honors `boot-recovery`, Android's
own `reboot recovery` becomes a supported entry without a custom RTC writer. But it is still one-shot, and it
requires writing `para` to request anything other than recovery. Treat it as a transport, not a state store.

### C. Chainload U-Boot (recommended)

`recovery` becomes U-Boot. U-Boot reads the ledger from `cache`/SD, loads the Linux kernel, DTB, and initrd, and
boots with a full command line. If the user chooses Android, U-Boot clears the RTC bit and resets; LK boots
Android normally. This preserves LK and Android, and gives us `fastboot boot` for RAM-only kernel tests.

It does **not** make Linux the cold-boot default. Under LK, a cold boot with the RTC bit clear goes to Android.
That is acceptable until Phase 4, and it is the safest default.

### D. U-Boot as primary

This is the only way to get a true "Linux by default, Android on demand" cold boot without an Android-side
arming service. It requires U-Boot to replace `lk` (or a custom LK that always chainloads U-Boot), to initialize
or inherit the display, to read keys, and ideally to boot Android's kernel with LK's MTK arguments. It is a large
port and the failure mode is BROM-only. Do not do it in the same phase as the chainload.

### E. Custom LK

Not worth it. LK is a known-good first stage; patching it adds a firmware-maintenance project and a high brick
risk for little gain over chainloading.

### F. `kexec`

Android's 3.18 kernel has no kexec support, and mainline kexec would still need a bootloader to select the target
after a power loss. It does not solve the cold-boot/fallback problem.

### G. `bootshim`

The `bootshim` project exists because some LKs cannot boot AArch64. Ours can: LK already boots our AArch64 kernel
with `bootopt=64S3,32N2,64N2`. A shim is only needed if the Phase 2 spike shows LK rejects a raw U-Boot payload.
Keep it as a contingency, not a plan.

---

## 5. Recommended architecture

### 5.1 Partition and media roles

| Partition / media | Phase 1 (hardened current) | Phase 2 (U-Boot) | Phase 3 (SD rootfs) |
|---|---|---|---|
| `lk` | stock, untouched | stock, untouched | stock, untouched |
| `boot` | Android + Magisk, untouched | same | same |
| `recovery` | mainline kernel + DTB + initramfs; ledger in the last 64 KiB | **U-Boot** (+ its DT); ledger in the tail | U-Boot; ledger fallback |
| `cache` | `/linux/rootfs.img` | `/linux/{Image,board.dtb,initramfs}` (read-only for U-Boot); rootfs optional | unused |
| `para` (misc/BCB) | read-only | read-only; optional transport | read-only |
| `userdata` | never | never | never |
| `system` | never | never | never |
| microSD | — | optional kernel/initrd | **FAT boot + A/B ext4 root + raw state** |

In the `cache` row, paths are relative to the cache filesystem: `/linux/...` is `/cache/linux/...` in Android and
`/mnt/cache/linux/...` in Linux.

### 5.2 Two operating modes

**Mode A — explicit boot manager (Phase 1–3, recommended).**

- Cold boot with no request → Android.
- Android → Linux: a root helper writes `target=linux`, arms the RTC, reboots.
- Linux → Linux: `tb-reboot linux` writes the ledger, arms the RTC, reboots.
- Linux → Android: `tb-reboot android` writes the ledger, clears the RTC, reboots.
- On a crash: if the RTC was armed for a retry, LK enters U-Boot, which checks the ledger; after N failures it
  selects Android and clears the arm. If the RTC was not armed, LK boots Android directly. In Phase 1 there is no
  U-Boot: LK's one-shot request gives a kernel that dies before stage 1 one attempt and then returns to Android
  (F8); stage 1 itself counts rootfs-mount failures and boots that reach init but never become healthy.
- The stage-1 GUI appears on every Linux boot and lets the user change the next target.

**Mode B — boot manager by default (Phase 4, optional).**

- Both Android and Linux re-arm the RTC after a healthy boot, so every reboot (and most cold boots, because the
  RTC domain survives power loss) enters U-Boot.
- U-Boot uses the ledger's `default_target` (Linux or Android) after a short timeout.
- Android must re-arm after each Android boot; if Android crashes before doing so, the next cold boot goes to
  Android directly. That is the safe failure.
- This is the mode that makes Linux feel like the primary OS. It is also the mode that makes U-Boot a single point
  of failure for every boot, so it comes last.
- **Charger-plug boots bypass it.** Plugging USB into a powered-off tablet makes LK take the power-off charging
  (KPOC) path, which boots Android's `boot` kernel in charger mode. In stock MTK LK, KPOC detection runs before
  the RTC recovery check. If this LK does the same, an armed RTC does not get a charger-plug boot into U-Boot,
  and pressing Power from the charging screen boots Android normally. Phase 0 must record what this LK does
  (test T26). At the time this was also the **only** way the tablet charged while off, because mainline had no
  charger driver; the SM5414 driver is implemented now (STATUS.md).

### 5.3 Boot intent state machine

Targets:

| Target | Meaning | Who acts |
|---|---|---|
| `android` | LK normal boot | LK |
| `linux` | U-Boot loads Linux | U-Boot |
| `fastboot` | LK fastboot or U-Boot fastboot | LK/U-Boot |
| `rescue` | U-Boot loads a known-good rescue kernel/initrd | U-Boot |
| `menu` | show the stage-1 chooser | stage 1 |
| `off` | reserved: power off / charge (not used in Phase 1–3) | PMIC |

Transitions:

| State / event | Next | Actor | State changes |
|---|---|---|---|
| Android, user selects Linux | `linux` | Android helper | `target=linux`, `armed=1`, `boot_attempt=0`, `seq++`, fsync, reboot |
| Android, user selects fastboot | `fastboot` | Android helper | `target=fastboot`, `armed=1`, `seq++`, reboot |
| Linux, healthy | `linux` (or default) | stage 2 | `last_stage=healthy`, `trial_attempt=0`, `boot_attempt=0`; Mode A: clear the RTC; Mode B: `armed=1` |
| Linux, user selects Android | `android` | `tb-reboot` / GUI | `target=android`, `armed=0`, `seq++`, reboot |
| Linux, user selects Linux | `linux` | `tb-reboot` / GUI | `target=linux`, `armed=1`, `boot_attempt=0`, `seq++`, reboot |
| Linux, crash before init | unchanged | none | Phase 2: armed → U-Boot retry; clear → Android. Phase 1: one-shot, so the next boot is Android (F8). |
| U-Boot, `target=linux`, relevant budget remains | `linux` | U-Boot | If the previous `last_stage=init`: `trial_attempt++`; otherwise `boot_attempt++`. `last_target=linux`; fsync; arm RTC for retry |
| U-Boot, kernel/initrd/DTB load fails | retry or `android` | U-Boot | `last_error=load_failed`, `boot_attempt++`; do not `booti` a stale address; at the limit select Android |
| U-Boot, `target=linux`, relevant budget exhausted | `android` or `last_good_slot` | U-Boot | `target=android` (or `slot=last_good_slot`), `armed=0`, `last_error=retry_exhausted`, fsync, reset |
| U-Boot, `target=android` | `android` | U-Boot | clear RTC, reset; LK boots Android |
| U-Boot, `target=fastboot` | `fastboot` | U-Boot | `fastboot usb 0` |
| U-Boot, `target=rescue` | `rescue` | U-Boot | load known-good kernel/initrd; do not touch `boot` |
| U-Boot, no valid state | `android` | U-Boot | `last_error=no_state`, clear RTC, reset |
| Stage 1, menu timeout | continue the current boot | stage 1 | record `last_target`; do not reboot on timeout (a timeout is not a request to change OS) |
| Stage 1, rootfs mount fails | retry or `android` | stage 1 | `last_stage=failed`, `last_error=rootfs_mount_failed`; Phase 1: `boot_attempt++`; Phase 2: leave `boot_attempt` alone (U-Boot counts the next boot). Arm/keep the RTC, reboot; after max, `target=android` (or `slot=last_good_slot` in Phase 3), clear RTC |
| Stage 1, rootfs mounted / `switch_root` | current | stage 1 | `last_stage=init`, `boot_attempt=0` (kernel, DT, initramfs and rootfs all proved); do **not** reset `trial_attempt` |
| Stage 2, crash before `healthy` | unchanged (next boot counts) | phase owner | on the next boot, if `last_stage=init`: `trial_attempt++`; after max, Android (normal generation) or `last_good_slot` (trial generation) |
| Stage 2, healthy after 60 s | current | stage 2 | `last_stage=healthy`, `trial_attempt=0`, `last_good_slot=slot`; Mode A: clear the RTC (disarm the retry); Mode B: `armed=1` |

Key rules:

- **One counter owner per phase.** In Phase 1, stage 1 increments the relevant counter. In Phase 2, U-Boot does;
  stage 1 only records progress. Within one boot, `last_stage` only advances `none → init → healthy`; a new boot
  starts a new `seq` and may set it to `init` again. A writer that would move it backwards within the same boot is
  ignored.
- **Reset `boot_attempt` only after the rootfs mounts.** Reaching the initramfs proves the kernel, DTB, and
  initramfs, not the rootfs. Stage 1 resets the counter just before `switch_root`. A rootfs that fails to mount
  therefore keeps consuming the pre-rootfs budget, and the phase owner falls back after N attempts.
- **`trial_attempt` is the health counter.** The phase owner increments it on the next boot when the previous boot
  wrote `last_stage=init` but never reached `healthy`; stage 2 resets it at `healthy`. After N, a trial generation
  rolls back to `last_good_slot`, and a normal generation selects Android/rescue. This is what bounds a stage-2
  crash loop; it is not limited to updates.
- **Arming policy.** Pick the budget that matches the failure mode. If the previous boot reached init but not
  `healthy`, arm while `trial_attempt < max_trial_attempts`; otherwise arm while
  `boot_attempt < max_boot_attempts`. Clear the RTC when that budget is exhausted. Do not OR the two budgets: a
  stage-2 crash must not keep retrying just because `boot_attempt` was reset by the rootfs mount.
- **An explicit target resets `boot_attempt`, not `trial_attempt`.** An explicit choice is not a pre-boot failure,
  but it does not erase the current generation's health history. Only `healthy` (or a new generation) resets
  `trial_attempt`.
- **Never trust the RTC bit as state.** U-Boot re-reads the ledger; if the bit is set but the ledger says Android,
  Android wins.

### 5.4 Boot ledger

Location:

- **Phase 1–2 (recommended): two 512-byte binary records in the last 64 KiB of `recovery`.** `recovery` is 16 MiB
  and the boot image (mainline now, U-Boot later) uses far less. Reserve the tail: `build-in-docker.sh` must cap the
  image at 16 MiB − 64 KiB. Copy A is at `recovery_size − 64 KiB` and copy B at `recovery_size − 32 KiB` (keep them
  in separate eMMC erase/write units). U-Boot writes them with `mmc write`, Linux and Android with `dd conv=fsync`
  on the partition node. Nobody writes to a filesystem.
- **Phase 1–2 (alternative): text files on `cache`.** `/cache/linux/bootstate` and `bootstate.bak`, `key=value`
  (Appendix A). This is easier to read, but U-Boot would have to write Android's ext4. U-Boot's `ext4write`
  deletes and recreates the file, so a reset part-way can leave Android's `cache` metadata inconsistent. It also
  refuses `metadata_csum` filesystems. Use this only if the `recovery` tail turns out not to survive (see below),
  and only with U-Boot treating the files as read-only.
- **Phase 3:** the same 512-byte binary record, in a reserved raw area of the microSD (two copies). Keep a text copy in
  the FAT boot partition for human inspection.

Why the `recovery` tail: R1 says this plan may write only `recovery`, and the invariants already treat `recovery` as
disposable. Losing the record is safe: restoring the full 16 MiB `recovery.bin` wipes it, and "no valid record"
means Android. **Verify before relying on it:** LK's `flash:recovery` (and `fb_send.py`) writes only the image
length and does not erase the whole partition; a reflash of a smaller image keeps the tail. If LK erases first, the
record resets to "no state", which is safe but loses history.

One format everywhere: a single static aarch64 tool (`tbstate`, a few hundred lines of C) reads, validates, and
writes the record. The same binary runs in stage 1, stage 2, and Android (the arm64 kernel runs static aarch64
binaries). U-Boot gets the same parser as a C command (section 7.6). Shell scripts call `tbstate get/set`; they never
compute a CRC themselves. (BusyBox has no `crc32`, and its `cksum` is the POSIX CRC, not CRC-32/IEEE.)
`tbstate dump` prints the `key=value` form of Appendix A for humans and for the status page.

The field names and semantics below are the same in all forms. A reader rejects a copy whose magic, size, or CRC
does not match and falls back to the other copy.

Binary format (proposed; 512 bytes, little-endian, CRC32 at the end):

| Field | Type | Meaning |
|---|---|---|
| `magic` | u32 | `'TBBS'` |
| `version` | u16 | 1 |
| `size` | u16 | 512 |
| `seq` | u32 | monotonic; highest valid copy wins |
| `generation` | u32 | increments on every kernel/rootfs update |
| `slot` | u8 | slot to boot: 0 = A, 1 = B |
| `last_good_slot` | u8 | last slot that reached `healthy`; rollback target |
| `target` | u8 | android/linux/fastboot/rescue/menu (off = reserved) |
| `default_target` | u8 | android/linux |
| `flags` | u8 | `armed`, `menu`, `trial`, `rescue`, `low_battery` |
| `boot_attempt` | u8 | attempts since the last rootfs mount/`healthy` (incremented before boot in Phase 2) |
| `max_boot_attempts` | u8 | default 3 |
| `trial_attempt` | u8 | boots that reached init but not `healthy` for this generation |
| `max_trial_attempts` | u8 | default 3 |
| `last_target` | u8 | target of the previous boot |
| `last_stage` | u8 | none/init/healthy/failed |
| `boot_reason` | u8 | cold/reboot/watchdog/panic/unknown (Phase 0 evidence) |
| `last_generation` | u32 | generation of the previous boot |
| `last_error` | u16 | enumerated reason |
| `kernel_sha256` | 32 B | optional integrity check |
| `rootfs_sha256` | 32 B | optional integrity check |
| `crc32` | u32 | over the preceding bytes |

Writers:

- **Android helper:** `target`, `armed`, `seq++`, fsync.
- **Linux `tb-reboot` / GUI:** same.
- **U-Boot:** if the previous `last_stage=init`, `trial_attempt++`; otherwise `boot_attempt++`. `last_target`,
  `last_error`, `target` on fallback, `armed`; fsync/flush.
- **Stage 1:** on a rootfs mount failure, `last_stage=failed`, `last_error=rootfs_mount_failed`, and (Phase 1)
  `boot_attempt++`; after the rootfs mounts and just before `switch_root`, `last_stage=init`,
  `boot_attempt=0`; writes the menu selection. It does not reset `trial_attempt`.
- **Stage 2:** `last_stage=healthy`, `trial_attempt=0`, `last_good_slot=slot`; Mode A clears the RTC, Mode B
  re-arms it.

Atomicity:

- **Every write increments `seq`.** A reader picks the valid copy with the higher `seq`; a writer updates the copy
  with the lower `seq`, so a torn write always leaves the other copy intact.
- Raw record (`recovery` tail or SD): write the slot with the lower `seq`, using the new `seq`, as one 512-byte
  sector, then flush (`mmc write` in U-Boot; `dd conv=fsync` or `O_DIRECT|O_SYNC` + `BLKFLSBUF` in Linux). A
  sector write is not guaranteed atomic on eMMC, which is why the CRC and the second copy exist.
- Text-file fallback (Linux only): write `bootstate.tmp` for the target copy with `seq = old_seq + 1`, `fsync`,
  `rename` over the older copy, `fsync` the directory. U-Boot only reads these files.
- Never update the ledger in place without a backup copy. Every writer reads both copies first, so it never
  overwrites the only valid one.

Why not U-Boot's environment: the grandpplte defconfig has no persistent `ENV_IS_IN_*` backend. `saveenv` would
either fail or need a new backend, and U-Boot env writes are not atomic. A dedicated record is simpler and
inspectable. For the same reason, do not `env import -t` the ledger in U-Boot. It would import any key in the file,
including `bootcmd`/`bootargs`, into the live environment.

Why not the RTC scratch registers: `RTC_PDN1` is only 16 bits and already has defined bits (fastboot/recovery/
power-on). `RTC_SPAR0/1` are used by MTK's alarm/power-on code (verify before repurposing them). A file/raw record
is safer and larger.

### 5.5 RTC and BCB rules

| Situation | RTC action | Ledger action |
|---|---|---|
| Android selects Linux | set recovery bits (`0x10`) | `target=linux`, `armed=1` |
| Android selects fastboot | set fastboot bit 13 | `target=fastboot`, `armed=1` |
| Linux selects Android | clear both fields | `target=android`, `armed=0` |
| Linux selects Linux | set recovery bits | `target=linux`, `armed=1` |
| U-Boot boots Linux, relevant budget remains | set recovery bits | if previous `last_stage=init`: `trial_attempt++`; else `boot_attempt++` |
| U-Boot boots Linux, relevant budget exhausted | clear recovery bits | fall back to Android/previous slot, so a crash does not loop |
| U-Boot selects Android | clear both fields, reset | `target=android`, `armed=0` |
| Linux healthy, Mode B | set recovery bits | `last_stage=healthy`, `armed=1` |
| Linux healthy, Mode A | clear both fields (disarm the retry U-Boot armed) | `last_stage=healthy`; a later crash or reboot defaults to Android |

BCB:

- Phase 0: dump the first 4 KiB of `para` before and after `adb reboot recovery`; compare. Do not write.
- If LK honors `boot-recovery`, add it as a secondary way for Android to request recovery. Keep the RTC + ledger
  path as the primary; do not let BCB and RTC disagree silently.
- If LK ignores it, leave `para` alone. Android still uses it for its own recovery; our path uses RTC.

### 5.6 Responsibilities

| Component | Responsibilities | Must not |
|---|---|---|
| Android helper (Magisk script/QSTile) | write intent, arm RTC, wait for `sys.boot_completed` before rebooting, reset Magisk's bootloop counter | write raw partitions; reboot before boot completion |
| LK | first stage; consume RTC bits; boot `boot`/`recovery`/fastboot | be modified |
| U-Boot | read ledger; load Linux/rescue; increment attempts; clear/arm RTC; provide fastboot/UMS | write `boot`, `lk`, `userdata`; enable `fastboot flash` by default |
| Stage 1 initramfs | show GUI; validate ledger; fsck; mount rootfs; fall back to shell/Android | depend on the rootfs to show the menu |
| Stage 2 | health marker; A/B trial; re-arm in Mode B; expose status | be the only place that knows the boot succeeded |
| Host scripts | flash/backup/restore; verify checksums; never assume a boot succeeded | write partitions other than `recovery`/SD |

### 5.7 End-to-end examples

**Android → Linux (Mode A):**

1. User taps "Boot Linux" in Android (or runs the helper).
2. Helper waits for `sys.boot_completed`, resets Magisk's counter, writes `target=linux, armed=1, seq++`, fsyncs,
   sets the RTC recovery bits, and reboots.
3. LK sees the recovery bits, clears them, boots `recovery` → U-Boot.
4. U-Boot reads the ledger: `target=linux`, `boot_attempt=0`. It writes `boot_attempt=1`, arms the RTC for a
   retry, loads `/linux/Image.gz`, `/linux/board.dtb`, `/linux/initramfs.cpio.gz`, and `booti`s Linux.
5. Stage 1 starts, shows the 5 s chooser, mounts the rootfs, then writes `last_stage=init`, `boot_attempt=0` and
   `switch_root`s.
6. Stage 2 reaches userspace; after 60 s it writes `last_stage=healthy`, `trial_attempt=0`. In Mode A it clears the
   RTC, so a later crash returns to Android.

**Linux → Android:**

1. `tb-reboot android` writes `target=android, armed=0, seq++`, clears the RTC, sysrq `s,u,b`.
2. LK boots `boot` normally. Android's Magisk counter is not involved because the boot completes.
3. Android's helper sees `target=android` and does nothing.

**Linux crash before the rootfs mounts (retry):**

1. U-Boot armed the RTC, so LK enters `recovery` again.
2. U-Boot reads `boot_attempt`; if it is below the limit, it retries. On the last attempt it clears the RTC and
   sets `target=android`, so the next crash returns to Android.

**Linux crash after the rootfs mounts but before healthy:**

1. `boot_attempt` is 0 (the rootfs mounted, so the chain is proved), but `last_stage=init`. On the next boot the
   phase owner increments `trial_attempt`. This applies to every generation, not just a trial update.
2. If the generation never becomes healthy after N tries, U-Boot restores `slot=last_good_slot` for a trial
   generation (section 9) or selects Android for a normal generation. The old rootfs is still intact. Because the
   arming policy keeps the RTC set while the health budget has room, a generation that reaches userspace but never
   becomes healthy still gets retried.

### 5.8 Hang detection and the health definition

The counters in 5.3 only advance when a failed boot **ends in a reset**. A panic resets (`panic=10`), but a hang
does not. A kernel that deadlocks before `mtk_wdt` probes, or a stage 2 that never becomes healthy and never
crashes, sits there until someone holds Power, and then the ledger has nothing to count. The watchdog has to
cover every stage up to `healthy`:

| Stage | Who arms the hardware watchdog | Timeout | What a hang does |
|---|---|---|---|
| LK → U-Boot (Phase 2) | LK (unknown, checklist item 4) | — | Unbounded unless LK left TOPRGU armed |
| U-Boot | `WDT_MTK` + `WATCHDOG_AUTOSTART` | ≤ 15.98 s (the driver's clamp) | Reset; the ledger counts it. U-Boot pets the watchdog in its main loop and during `fastboot`. |
| U-Boot → kernel → `mtk_wdt` probe | still the U-Boot-armed TOPRGU | same | Reset if the kernel hangs before probe. Linux `mtk_wdt` sees the running watchdog and keeps petting it (`WATCHDOG_HANDLE_BOOT_ENABLED=y`). |
| Kernel → stage 2 `healthy` | kernel petting + a **health deadline** in stage 1 | e.g. 180 s | Stage 1 starts a deadline (a forked timer that does sysrq `s,u,b`, plus an open-and-never-pet `/dev/watchdog` backstop as `init` does today). Stage 2 cancels it at `healthy`. |
| After `healthy` | kernel petting | — | Kernel lockups still reset; userspace hangs do not (by design: a healthy session should not reboot on its own). |

In Phase 1 (no U-Boot), the first row is LK's behaviour. If LK does not leave the watchdog armed, an early kernel
hang needs a long press, and that boot ends in Android because the RTC request was one-shot. That is safe.

**Healthy must mean healthy, not "60 s of uptime".** Define it as a short list of checks run by stage 2: the root
filesystem is mounted read-write, `sshd`/telnet is listening, the kiosk (or whatever the default session is) is
running, and the ledger write succeeded. Write `last_stage=healthy` only when all of them pass, and no sooner than
60 s after boot. A generation that boots but never starts its session is then retried and rolled back, instead of
being marked good.

---

## 6. Phased plan

Each phase is independently useful and reversible. Do not start the next phase until the exit criteria are met.

### Phase 0 — Instrument and verify (no behaviour change)

**Why:** You cannot make the boot path robust while its current state is invisible. This phase only adds
observability and answers the open questions that block the design.

**Changes:**

- Add `mainline/scripts/tb-bootstate` (host and device) to read/write/validate the ledger; start with a
  read-only dump of the RTC `PDN1`, the first 4 KiB of `para`, `/proc/cmdline`, and the last pstore record.
- Add a boot log line in stage 1 and stage 2: kernel build ID, DTB hash, rootfs image hash, target, attempt,
  last result.
- Enable/persist `pstore`/`ramoops` across Android boots (already in the DTS); add a host command to pull the last
  crash.
- Measure and record: LK menu key combo (Power+Vol Up, Power+Vol Down, both volumes), whether LK honors BCB,
  whether LK leaves the watchdog armed, and the actual `cache` size/free space. For the BCB test, enter recovery
  with `linux-test.sh to-recovery`, not a bare `adb reboot recovery` (Magisk counter, F10).
- Record what a charger-plug cold boot does with the RTC recovery bits set: KPOC (Android charger) or `recovery`
  (T26).
- Check that `fb_send.py … flash:recovery` with a small image leaves the last 64 KiB of `recovery` untouched
  (write a marker there, flash, read it back). This decides where the ledger lives (section 5.4).
- Check that Android does not rewrite `recovery` at boot (no `install-recovery.sh`/`recovery-from-boot.p` in
  `/system`). The current flow already suggests it does not, but the ledger-in-`recovery` design depends on it.
- Add a "boot reason" field (cold boot, reboot, watchdog, panic, power loss) using the PMIC/RTC power-on reason
  if available, else `unknown`.
- Document the current `tb-reboot` and `linux-test.sh` behaviour in one place.

**Tests:** 10 cold boots, 10 Android→Linux→Android cycles, 10 Linux→Linux reboots; the ledger must match reality
every time.

**Exit criteria:** every F1–F14 failure has a recorded symptom and a log; the BCB and key-combo questions are
answered; no partition is written.

**Rollback:** none needed; all changes are read-only or host-side.

### Phase 1 — Harden the current path

**Why:** This fixes the selection/state problems without U-Boot or microSD. It is the highest-value phase.

**Changes:**

- **Atomic rootfs update.** In `init`, keep the old image until the new one is decompressed, checksummed, and
  mounted; use `rootfs.img.new` + `rename`; keep `rootfs.img.prev` if space allows. Never `rm` the working image
  first.
- **Boot ledger** (section 5.4): two raw copies with CRC in the `recovery` tail, written only through the `tbstate`
  tool. Cap the boot image at 16 MiB − 64 KiB in `build-in-docker.sh`. Stage 1 increments `boot_attempt` and writes
  `init` after the rootfs mounts; stage 2 writes `healthy` using the checks in section 5.8.
- **Health deadline** (section 5.8): stage 1 arms it, stage 2 cancels it at `healthy`.
- **Stage-1 GUI chooser** (section 8): Linux / Android / Fastboot / Rescue, 5 s countdown, touch + volume keys.
- **Android entry helper:** a Magisk service or QSTile that waits for boot completion, resets the Magisk counter,
  writes the ledger, arms the RTC, and reboots. No raw partition writes.
- **`tb-reboot` v2:** `linux`, `android`, `fastboot`, `rescue`, `menu`; writes the ledger first, then the RTC,
  then sysrq. Never a bare `reboot -f`.
- **fsck:** add a static `e2fsck` to the initramfs; run `e2fsck -p` on the loop image (or the SD rootfs later)
  before mounting. If it fails, use the previous image/slot.
- **Autoreboot policy:** keep 300 s for bring-up, but make `/etc/tb-autoreboot` explicit; a desk device should
  stay in Linux. Until a charger/battery driver exists, a "low battery" check can only read the SM5414 status over
  i2c or be deferred; do not claim a full battery policy (R12).
- **Status page:** extend `/www/status.txt` and the PocketJS status with the ledger and last boot result.

**Tests:** section 11, especially F5/F6 (corrupt/update rootfs), F1/F2 (intent/ledger), F10 (Magisk), and 50
reboot cycles. The GUI must work with the rootfs image deleted.

**Exit criteria:** 50 consecutive Linux boots with no manual intervention; a corrupt rootfs update leaves the old
image bootable; the GUI selects Android/Linux/fastboot reliably; the ledger survives a power loss at every write
point.

**Rollback:** restore the previous `recovery` image and zero the ledger tail (`tbstate wipe`; "no state" means Android); Android is untouched.

### Phase 2 — Chainload U-Boot from `recovery`

**Why:** U-Boot gives `fastboot boot` (RAM-only kernel testing), a full kernel command line, loading from
cache/SD, and a boot script. This removes the "flash recovery for every kernel test" loop and prepares Phase 3.

**Spike first (before changing the daily boot path):**

1. Build a tiny AArch64 payload (or U-Boot with `CONFIG_BOOTCOMMAND="fastboot usb 0"`) and package it as a boot
   image with `kernel_addr=0x40080000`.
2. Flash it to `recovery`, `oem reboot-recovery`, and check for the U-Boot fastboot device `0e8d:201c` on the host.
   If it appears, LK's jump and U-Boot's entry work. If not, stop and investigate the payload format/entry
   (the `bootshim` contingency).
3. Boot a known-good Linux image with `fastboot boot`; confirm stage 1 and SSH. This proves the full path before
   committing.

**Changes:**

- Build the TB-7304X U-Boot (section 7). Pin the source commit; keep the defconfig, DTS, and any patches in
  `mainline/u-boot/` or a `mainline/patches/u-boot-*` directory.
- Move the mainline kernel/DTB/initramfs from `recovery` to `/cache/linux/` (the cache filesystem's `/linux/`; or
  SD). Store the kernel as an uncompressed `Image` for `booti`, or use a FIT image; the LK boot image's
  `Image.gz` is not directly bootable by `booti`. Keep a copy of the current known-good `recovery` image on the
  host and on cache.
- Flash U-Boot to `recovery`. Keep stock `recovery.bin` and the previous mainline recovery image.
- Add the `tb_select` and `tb_bootmode` C commands (section 7.6) and a thin boot script that dispatches on
  `tb_target`, loads kernel/DTB/initrd, and runs `booti`/`bootm`.
- Enable `WDT_MTK` with autostart, so U-Boot and the early kernel run under the hardware watchdog (section 5.8).
- U-Boot increments `boot_attempt`; stage 1 resets it only after the rootfs mounts. U-Boot also increments
  `trial_attempt` when the previous boot reached `init` but not `healthy`.
- U-Boot enters `fastboot usb 0` when `target=fastboot`, or when a volume key is held at boot (if a key driver is
  added; otherwise via the ledger).
- **Android path:** U-Boot clears the RTC and resets; LK boots Android. Do not enable U-Boot `fastboot flash` yet.
- Add a recovery image to the host release: `u-boot-tb7304x.img` plus a checksum and a one-command restore.

**Tests:** section 11 plus 100 boot cycles, 20 `fastboot boot` tests, a U-Boot hang (watchdog/ledger fallback),
a corrupt U-Boot image (LK fastboot restore), and a power loss during a U-Boot update.

**Exit criteria:** `fastboot boot` works reliably; Linux boots from cache with a full cmdline; Android selection
returns to LK normal; a bad U-Boot can be restored via LK fastboot or BROM without touching `boot`; the ledger
records attempts correctly.

**Rollback:** reflash `backup/partitions/recovery.bin` (stock) or the previous mainline recovery image with
`fb_send.py`/BROM. `boot` and `lk` are untouched.

### Phase 3 — Rootfs on microSD with A/B

**Why:** This fixes the media problem: size, cache wipes, double journaling, fsck, and non-atomic updates.

**Changes:**

- Enable `msdc1` in the mainline DTS (regulators, pinctrl, card-detect GPIO 11) and in U-Boot (already enabled in
  `mt6735-common.dtsi`; verify card-detect and UHS).
- SD layout: FAT boot partition (`TBBOOT`, 128 MB) + ext4 root A + ext4 root B + optional data; a raw bootstate
  record in the reserved area before partition 1.
- U-Boot loads the kernel/DTB/initrd from FAT (or a FIT image), passes `root=PARTUUID=...`, and selects the A/B
  slot from the ledger.
- Stage 1 fsck + mount + GUI; stage 2 health/trial/re-arm; atomic A/B updates (write inactive slot, verify,
  switch, trial, roll back on failure).
- Rescue: a third copy of a known-good kernel/initrd on FAT, plus a separate rescue SD card.
- Migration: copy the current Alpine rootfs into slot A (rsync/tar), verify, boot it once, then retire the cache
  image.

**Tests:** corrupt slot A, remove the SD mid-boot, power loss during an update, fill the FAT partition, wrong
PARTUUID, card-detect removal, U-Boot SD read failure, and a 100-cycle A/B update loop.

**Exit criteria:** Linux boots from SD with no cache dependency; an interrupted update always leaves one bootable
slot; fsck runs before mount; the rescue path works with the rootfs slots both corrupt.

**Rollback:** keep the cache image and the current `recovery` image; boot with `tb.r=1`/cache if the SD path fails.

### Phase 4 — Optional Linux default / primary U-Boot

**Why:** Only if the tablet should behave like a Linux-first device, with Android as the guest.

**Changes (choose one):**

- **Mode B without replacing LK:** Android and Linux re-arm the RTC after healthy boots; U-Boot's
  `default_target=linux`; the stage-1 GUI still appears. Cold boot after a power loss enters U-Boot only if the
  RTC bit survived. This is the lower-risk way to get Linux-by-default.
- **Replace `lk` with U-Boot:** only after a full U-Boot port (display, keys, Android boot, ATF handoff), a
  hardware watchdog, a proven BROM restore, and 500+ test boots. This is a separate project, not part of this
  plan's default path.

**Tests:** 500 boots, random power cuts, Android boot after N Linux boots, U-Boot corruption, low battery,
watchdog reset, and a full BROM restore drill.

**Exit criteria:** a cold boot with no input reaches the configured default; a failed Linux boot reaches Android
within one attempt limit; no scenario requires opening the case or a host PC except a deliberate BROM restore.

**Rollback:** clear the persistent arm, restore stock `recovery`, and (if `lk` was replaced) restore `lk.bin` via
BROM. Keep the BROM procedure printed and tested.

---

## 7. U-Boot: whether and how

### 7.1 Verdict

Build U-Boot **as a chainloaded second stage**, not as a replacement for LK. It is worth the effort because it
provides:

- `fastboot boot` for RAM-only kernel testing (the current LK cannot do this);
- a full kernel command line (no 99-character LK limit);
- loading the kernel/initrd from cache or microSD (no 16 MiB `recovery` limit);
- a boot script and a place for A/B selection, rescue, and a future menu;
- U-Boot fastboot/UMS as a second recovery path.

It does **not** provide a cold-boot Linux default while LK is the first stage, and it does not fix the rootfs
media problem. Those are separate phases.

### 7.2 Source and version

```sh
git clone https://gitlab.com/mt6735-mainline/u-boot.git
cd u-boot
git checkout 3d74bf168618b78567c31b3f4ec96430f3b565c8
# Makefile says VERSION 2023, PATCHLEVEL 04, EXTRAVERSION -rc1
```

Pin the commit. If a newer `mt6735-staging` commit is used, re-check the defconfig, the RTC/PMIC changes, and the
DTS before flashing.

### 7.3 Board port

Create `configs/tb7304x_defconfig` from `configs/grandpplte_defconfig`, with these changes:

| Option | Value | Why |
|---|---|---|
| `CONFIG_TEXT_BASE` | `0x40080000` | LK requires 512 KiB alignment; grandpplte's `0x40008000` is not aligned. |
| `CONFIG_SYS_LOAD_ADDR` | `0x40080000` | Matches LK's kernel address and the Linux Image `text_offset`. |
| `CONFIG_DEFAULT_DEVICE_TREE` | `"mt6737m-lenovo-tb7304x"` | New U-Boot DTS. |
| `CONFIG_DEFAULT_FDT_FILE` | `"mt6737m-lenovo-tb7304x.dtb"` | Same. |
| `CONFIG_BOOTDELAY` | `0` | grandpplte uses `0` with `AUTOBOOT_KEYED`. There is no serial console or key driver to interrupt autoboot, so a delay only slows every boot. Raise it when a key driver exists. |
| `CONFIG_BOOTCOMMAND` | `"source 0x44000000"` or `"run tb_boot"` | `tb_boot` must be defined; see the note below. |
| `CONFIG_ANDROID_BOOT_IMAGE` | `y` | Needed for `fastboot boot` of Android-format test images. Note that U-Boot's Android loader does **not** extract an appended DTB; use a FIT image or a header-v2 `dtb` field for daily boots. Do not use it to boot Android. |
| `CONFIG_FASTBOOT_BUF_ADDR` | `0x50000000` | `0x41000000` falls inside the 26.9 MB kernel range `0x40080000`–`0x41a80000`; the gunzip source and destination would overlap. |
| `CONFIG_FASTBOOT_BUF_SIZE` | `0x7000000` (112 MiB) | Fits kernel + initrd; stays below the framebuffer. |
| `CONFIG_FASTBOOT_FLASH` | **off** initially | Avoid accidental eMMC writes. Enable later, with an allowlist. |
| `CONFIG_CMD_BCB` | `y` | Read/inspect BCB; do not depend on it. |
| `CONFIG_CMD_BOOTI` | `y` | ARM64 Linux Image. |
| `CONFIG_CMD_EXT4`, `CONFIG_CMD_FAT`, `CONFIG_CMD_PART` | `y` | Read cache/SD; `part number` resolves names. |
| `CONFIG_EXT4_WRITE` | **off** (grandpplte has it on) | U-Boot must not write Android's `cache` (invariant 10). |
| `CONFIG_CMD_GPT` | **off** (grandpplte has it on) | `gpt write` can destroy the eMMC partition table; `part` is enough for reading. |
| `CONFIG_USB_FUNCTION_MASS_STORAGE` / `ums` | keep, but only ever `ums 0 mmc 1` (SD) | `ums 0 mmc 0` exports the whole eMMC read-write, `lk`/`boot`/GPT included. Do not put it in any script; consider patching `ums` to refuse `mmc 0`. |
| `CONFIG_WDT_MTK` | `y` | Handle the MTK watchdog (grandpplte leaves it off). |
| `CONFIG_WATCHDOG_AUTOSTART`, `CONFIG_WATCHDOG_TIMEOUT_MSECS` | `y`, `15000` | Hang detection from U-Boot until Linux `mtk_wdt` takes over (section 5.8). The driver clamps at 15984 ms. |
| `CONFIG_CMD_CRC32` / `CONFIG_HASH` | `y` | Ledger CRC check, if any of it stays in script form. |
| `CONFIG_SYSRESET`, `CONFIG_SYSRESET_WATCHDOG` | `y` | Reset paths. |
| `CONFIG_VIDEO`, `CONFIG_DM_VIDEO`, `CONFIG_VIDEO_SIMPLE`, `CONFIG_VIDEO_DT_SIMPLEFB` | optional | U-Boot text menu on LK's framebuffer. Requires the right format and no display re-init. |
| `CONFIG_DM_KEYBOARD` + a keypad driver | optional | Volume keys for the menu; not in the port today. |
| `CONFIG_ENV_IS_NOWHERE` | `y` | No persistent env; the ledger is a file/raw record. |
| `CONFIG_SYS_MEM_TOP_HIDE` | `0x01000000` | Hide LK's top 16 MiB framebuffer from U-Boot's RAM top. The symbol already exists in the top-level `Kconfig` and is applied in `common/board_f.c`; just set it. |

Keep `CONFIG_POSITION_INDEPENDENT=y`. Do not enable `CONFIG_FASTBOOT_UUU_SUPPORT` (it allows arbitrary commands).

**Where `tb_boot` lives.** The grandpplte port's `CONFIG_BOOTCOMMAND` is `source 0x44000000:bootscript`, i.e. it
sources whatever LK placed at the boot image's ramdisk address (`0x44000000`; the `:bootscript` suffix is ignored
by `source`). Reuse that mechanism: build `boot.scr` with `mkimage -T script`, package it as the U-Boot boot image's
ramdisk, and use `CONFIG_BOOTCOMMAND="source 0x44000000"`. Alternatively embed the whole script in
`CONFIG_BOOTCOMMAND`, but quoting and the env size limit make that fragile. Do not rely on `saveenv`: there is no
persistent environment backend.

### 7.4 U-Boot device tree

Start from `arch/arm/dts/mt6737t-samsung-grandpplte.dts`; create
`arch/arm/dts/mt6737m-lenovo-tb7304x.dts`:

```dts
/dts-v1/;
#include "mt6735-common.dtsi"
#include <dt-bindings/gpio/gpio.h>

/ {
    model = "Lenovo TB-7304X";
    compatible = "lenovo,tb7304x", "mediatek,mt6735";

    memory {
        device_type = "memory";
        reg = <0x40000000 0x40000000>;   /* 1 GiB */
    };

    reserved-memory {
        #address-cells = <1>;
        #size-cells = <1>;
        ranges;

        atf@43000000 {
            reg = <0x43000000 0x00030000>;
            no-map;
        };

        ram_console@43f00000 {
            reg = <0x43f00000 0x00010000>;
            no-map;
        };

        pstore@43f10000 {
            reg = <0x43f10000 0x000e0000>;
            no-map;
        };

        minirdump@43ff0000 {
            reg = <0x43ff0000 0x00010000>;
            no-map;
        };

        framebuffer@7f000000 {
            reg = <0x7f000000 0x01000000>;
            no-map;
        };
    };
};

&mmc1 {
    /* stock DT uses flags 0 (GPIO_ACTIVE_HIGH) and cd_level = 1; verify the real polarity with a card */
    cd-gpios = <&gpio 11 GPIO_ACTIVE_HIGH>;
    /* grandpplte overrides these to the fixed vdd_tflash regulator; the TB-7304X uses PMIC vmch/vmc */
    vmmc-supply = <&vmch>;
    vqmmc-supply = <&vmc>;
    status = "okay";
};
```

The exact GPIO controller phandle and polarity must be checked against `mainline/stock/stock.dts` (`cd-gpios =
<0x09 0x0b 0x00>`, i.e. GPIO 11, flags 0 = active high) and the mainline `pio` node. The stock node also sets
`cd_level = [01]` and uses a debounced EINT (`msdc1_ins-eint`). Do not guess: verify by inserting and removing a
card and reading the GPIO value. If the physical CD# signal is active low, flip the flag; the kernel accepts either
as long as the flag matches the wiring.

grandpplte overrides `mmc1`'s supplies to a fixed `vdd_tflash` regulator. Delete that override for the TB-7304X:
the stock DTS marks `msdc1` with `sd_need_power` and uses the PMIC `vmch`/`vmc` rails. Without this, the card may
be unpowered in U-Boot even though the controller probes.

**Important:** when LK boots Linux, it rewrites `/memory` from its mblock table and excludes its own reservations.
When U-Boot boots Linux, that rewrite does not happen. Add `reserved-memory` entries for ATF (`0x43000000`) and the
framebuffer (`0x7f000000`–`0x80000000`) to the **Linux** board DTS before Phase 2; the current mainline DTS already
reserves pstore, ram_console, and minirdump. The entries in the U-Boot control DT above are not automatically passed
to Linux; the boot script loads the Linux DT separately.

Also account for the stock DT's dynamic carveouts: `reserve-memory-ccci_md1` (56.25 MiB, 32 MiB aligned) and
`consys-reserve-memory` (1 MiB, 2 MiB aligned). They are allocated by the stock Android kernel, and mainline does
not run the modem or CONSYS, so they are probably unused — but before handing the full 1 GiB to Linux under U-Boot,
compare with the memory map LK produces today (`/proc/iomem` on a current LK-booted Linux) and reserve any range LK
withholds. This is a verification item, not a reason to keep LK's rewrite.

Optional simplefb node (only after the format/stride are confirmed from `lkfb:`/OVL0):

```dts
framebuffer@7f7b0000 {
    compatible = "simple-framebuffer";
    reg = <0x7f7b0000 0x00260000>;
    width = <600>;
    height = <1024>;
    stride = <2432>;
    format = "a8b8g8r8";   /* verify against LK's OVL format */
};
```

Do **not** let U-Boot reprogram the display clocks. It must only write into LK's live framebuffer. If the format
is wrong, the menu will have wrong colours but the boot path still works; fix the format separately.

This DTS is U-Boot's **control** DT. The Linux DT loaded by the boot script is a separate file; the framebuffer
and ATF reservations must be present in both (see the note above). Do not assume U-Boot's reserved-memory nodes
are passed to Linux.

### 7.5 Memory map

| Range | Use | Notes |
|---|---|---|
| `0x40000000`–`0x4007ffff` | unused | Keep free. |
| `0x40080000`–`0x401fffff` | U-Boot initial image (LK puts it here) | `TEXT_BASE=0x40080000`. U-Boot relocates itself to the top of RAM before the boot script runs, so this range is free again afterwards. |
| `0x40200000`–`0x42dfffff` | Linux kernel (`kernel_addr_r=0x40200000`) | 2 MiB-aligned, so `booti` runs it in place instead of `memmove`-ing it. Check that the Image header's `image_size` (file + BSS) ends below `0x43000000`; the 26.9 MB file leaves ~21 MB for BSS. |
| `0x43000000`–`0x4302ffff` | ATF | Reserved; never load here. |
| `0x43f00000`–`0x43ffffff` | pstore / ram_console / minirdump | Reserved; never load here. |
| `0x44000000`–`0x440fffff` | `boot.scr` (the boot image's ramdisk, placed by LK) | Read by `source` before anything else is loaded. |
| `0x47f00000` | Linux DTB (`fdt_addr_r`) | |
| `0x48000000`–`0x4fffffff` | initramfs (`ramdisk_addr_r`, up to 128 MiB) | Far from the kernel's BSS; the old `0x42000000` slot overlapped a relocated kernel. |
| `0x50000000`–`0x56ffffff` | fastboot download buffer (112 MiB) | `FASTBOOT_BUF_ADDR`; avoids ATF and the kernel. |
| `0x7f000000`–`0x7fffffff` | LK framebuffer | Hidden from U-Boot with `SYS_MEM_TOP_HIDE=0x01000000`. |
| below `0x7f000000` | U-Boot relocation | U-Boot relocates near `ram_top - size`; verify the actual address in `bdinfo`. |

Set `fdt_high=0xffffffffffffffff` and `initrd_high=0xffffffffffffffff` so U-Boot boots the FDT and initrd where
they were loaded instead of copying them near the top of RAM. Verify with `bdinfo` and the first boot's
`/proc/iomem`.

Do not add a guessed MD/CCCI reservation to this table. The stock kernel allocates it dynamically (56.25 MiB,
32 MiB aligned); read the real address from `/proc/iomem` on the current LK-booted mainline and reserve that exact
range if LK/MD still owns it. The modem is not started under mainline, but the range must be confirmed, not assumed.

### 7.6 RTC writes from U-Boot

`cmd/pmic.c` goes through `pmic_reg_write()` → `pmic_write()`, which needs the byte-wise `ops->write`. The MT6328
driver implements only `read_u32`/`write_u32`, so `pmic write` returns `-ENOSYS`: it does nothing, rather than
corrupting `RTC_PDN1`. Either way it cannot be used for the boot mode.

Add a small `tb_bootmode` command (or a board function) that:

1. Gets the PMIC device (`uclass_get_device(UCLASS_PMIC, 0, &pmic)`).
2. Calls `pmic_clrsetbits(pmic, 0x402c /* RTC_PDN1 */, (3 << 4) | BIT(13), set)`. That function already does a
   16-bit read-modify-write through `read_u32`/`write_u32`, so no other `PDN1` bits change.
3. Writes `RTC_WRTGR` (`0x403c`) = 1 with `pmic_write_u32` and polls `RTC_BBPU` (`0x4000`) bit 6 (`CBUSY`) until it
   clears, with a bounded loop (1000 × 10 µs, as in the Linux driver).
4. Reads `RTC_PDN1` back and fails loudly if it does not match.

**Put the decision logic in C too.** A `tb_select` command does the work: it reads both ledger copies with
`blk_dread`, checks magic/size/CRC, applies the 5.3 rules, writes the updated record, arms or clears the RTC, and
sets one env variable (`tb_target=linux|rescue|android|fastboot`). The boot script then only dispatches on
`tb_target`. Doing CRC checks, counter arithmetic, and two-copy selection in hush is fragile and hard to test.
`tb_select` can share its parser source with the Linux `tbstate` tool and be unit-tested on the host.

Expose:

```
tb_bootmode android|linux|fastboot|normal|status
```

Use it from the boot script and from the ledger fallback. Keep the Linux `mtk-rtc-boot-mode` driver as the
userspace interface to the same bits.

### 7.7 Packaging and flashing

Verify that the build produced a U-Boot binary with the DT appended (`u-boot.bin` should be the `u-boot-dtb.bin`
content when `OF_SEPARATE` is selected; otherwise use `u-boot-dtb.bin` explicitly). Package it, gzipped, as an
Android boot image with the same header layout as the current mainline images:

```sh
gzip -9 -c build/u-boot.bin > build/u-boot.bin.gz
# LK looks for a DTB by scanning the *stored* kernel blob backwards for d00dfeed. Inside the gzip stream it
# cannot see U-Boot's own DT, so append a plain DTB after the gzip, exactly like the Linux images do.
cat build/u-boot.bin.gz build/arch/arm/dts/mt6737m-lenovo-tb7304x.dtb > build/u-boot.bin.gz-dtb
mkimage -A arm64 -T script -C none -n tb_boot -d boot.cmd build/boot.scr
mkbootimg --base 0x40000000 --kernel_offset 0x00080000 \
  --ramdisk_offset 0x04000000 --second_offset 0x00f00000 \
  --tags_offset 0x0e000000 --pagesize 2048 --header_version 0 \
  --os_version 7.0.0 --os_patch_level 2018-07 --board 1535456354 \
  --kernel build/u-boot.bin.gz-dtb --ramdisk build/boot.scr \
  --cmdline "bootopt=64S3,32N2,64N2" \
  -o out/u-boot-tb7304x.img
```

A raw (uncompressed) `u-boot.bin` also works if LK accepts it, but the gzip path is the one already exercised by
every Linux image. The decompressed U-Boot is far below LK's 28 MiB limit.

Packaging `boot.scr` as the ramdisk puts it at `0x44000000` (base + `--ramdisk_offset 0x04000000`), which is exactly
where the grandpplte port's `source 0x44000000:bootscript` expects it. Use `CONFIG_BOOTCOMMAND="source 0x44000000"`.
If the script is embedded in `CONFIG_BOOTCOMMAND` instead, `--ramdisk /dev/null` is enough.

The cache filesystem is the root of `mmc 0:<cache_part>` in U-Boot, so `/linux/...` in the boot script is
`/mnt/cache/linux/...` in Linux and `/cache/linux/...` in Android.

- Set `kernel_addr` to `0x40080000` (via `--base` + `--kernel_offset`), not grandpplte's `0x40008000`.
- LK scans backwards from the end of the **stored** (still gzipped) kernel blob for the DTB magic. U-Boot's own DT is
  appended to `u-boot.bin` *before* compression, so LK cannot see it. Without the plain DTB appended after the gzip
  (above), LK finds no DTB and may refuse to boot. What LK does with no DTB is unverified, so do not test it on the
  daily path. LK then patches that DTB (`/memory`, `/chosen` atags, `bootargs`) and passes it in `x0`. U-Boot
  ignores `x0` and uses its built-in DT. **Worth keeping:** stash `x0` early (`save_boot_params`) and expose it as
  `prevbl_fdt_addr`. LK's patched `/memory` is the real carveout map (checklist item 10), and `atag,boot` carries
  LK's boot mode/reason, which can fill the ledger's `boot_reason`.
- Keep the cmdline short; `bootopt=64S3,32N2,64N2` selects AArch64. U-Boot does not need LK's Linux cmdline.
- Flash only `recovery`:

```sh
python3 -I mainline/scripts/analysis/fb_send.py out/u-boot-tb7304x.img flash:recovery
python3 -I mainline/scripts/analysis/fb_send.py - "oem reboot-recovery"
```

- Keep `backup/partitions/recovery.bin` and the previous mainline recovery image. Test the restore before relying
  on U-Boot.
- U-Boot does not pass LK's `/chosen/atag,videolfb`. The current kernel uses `mediatek-drm` and the board DTS, so
  this should be fine, but verify that nothing still depends on `lkfb`/simpledrm. If the display stays dark, add the
  `atag,videolfb` values to the Linux DT or fix the DRM probe; do not assume U-Boot will light the panel.

### 7.8 U-Boot boot script (outline)

```
# tb_boot: all ledger logic is in the C command tb_select (section 7.6). It reads both
# raw ledger copies, validates them, updates the counters, writes the record, arms or
# clears the RTC, and sets tb_target. Missing or invalid state => tb_target=android.
tb_select || setenv tb_target android

if test "${tb_target}" = "fastboot"; then
    fastboot usb 0          # the watchdog is petted inside the fastboot loop
    tb_bootmode android; reset
fi

if test "${tb_target}" = "rescue"; then
    setenv tb_dir /linux/rescue
elif test "${tb_target}" = "linux"; then
    setenv tb_dir /linux
else
    tb_bootmode android     # android, or anything unknown
    reset
fi

setenv kernel_addr_r  0x40200000
setenv fdt_addr_r     0x47f00000
setenv ramdisk_addr_r 0x48000000
setenv fdt_high       0xffffffffffffffff
setenv initrd_high    0xffffffffffffffff
part number mmc 0 cache cache_part
if ext4load mmc 0:${cache_part} ${kernel_addr_r} ${tb_dir}/Image && \
   ext4load mmc 0:${cache_part} ${fdt_addr_r} ${tb_dir}/board.dtb && \
   ext4load mmc 0:${cache_part} ${ramdisk_addr_r} ${tb_dir}/initramfs.cpio.gz; then
    setenv bootargs "console=tty0 ... panic=10 oops=panic tb.gen=${tb_gen} tb.seq=${tb_seq}"
    booti ${kernel_addr_r} ${ramdisk_addr_r}:${filesize} ${fdt_addr_r}
fi

# Any load or booti failure is a failed attempt; never booti a stale address.
tb_select --fail load_failed     # records it; at the limit it switches the target to android
reset
```

This is an outline, not a script to paste. The exact `mmc` device/partition numbers, file paths, and `bootargs`
must be verified on the device. **Partition names are not accepted by `mmc 0:cache`**: this U-Boot's
`blk_get_device_part_str()` parses a numeric ID only (`disk/part.c`), so resolve the name with
`part number mmc 0 cache cache_part` first. `booti` expects an uncompressed arm64 `Image`; it does not gunzip a raw
`Image.gz` loaded from ext4. Store `/linux/Image` (or call `gunzip` explicitly, or use a FIT image with `bootm`),
not the LK boot image's `Image.gz`. The initramfs is loaded last, so `${filesize}` is its size, which the
`addr:size` form of `booti` needs for a raw (non-mkimage) initrd. Do not trust a `target=linux` from a torn or
forged ledger: that is `tb_select`'s job, not the script's. A FIT image is the better long-term format because it
carries the kernel, DTB, ramdisk, and hashes together; `bootm` handles compression and verifies the hashes. Use FIT
in Phase 3. Android can wipe `cache` between boots, so a missing `/linux/Image` must be an ordinary `load_failed`,
not a hang.

### 7.9 What works, what does not

| Capability | Status | Notes |
|---|---|---|
| AArch64 payload at `0x40080000` | ⚠️ to verify | LK alignment + entry contract; spike first. |
| `fastboot boot` | ✅ in source; ⚠️ untested | The main reason to build U-Boot. Our test images are Android boot images with a DTB appended to the kernel; `android_image_get_kernel()` reads only the header kernel/ramdisk/second/dtb fields and does **not** extract an appended DTB. Use a FIT image or a header-v2 `dtb` field before relying on `fastboot boot` for the daily kernel. |
| `fastboot flash` | ✅ in source; **disabled** | Enable only after the port is proven. |
| ext4/FAT from eMMC | ✅ in source | eMMC `cache`, later SD. |
| SD (`mmc1`) | ✅ in source; ⚠️ untested | Regulators/pinctrl present; card-detect and the `vmch`/`vmc` supplies need verification (remove grandpplte's `vdd_tflash` override). |
| Display / menu | ❌ not in defconfig | `VIDEO_SIMPLE` exists; needs format/stride and no display re-init. |
| Keypad | ❌ no driver | Volume keys are on the SoC keypad matrix; a small driver is needed. |
| Boot Android directly | ❌ not recommended | `ANDROID_BOOT_IMAGE` can parse the image, but LK's MTK `atag`/`bootopt` handoff is not replicated. Reset to LK instead. |
| Persistent env | ❌ none | Use the ledger file/raw record. |
| RTC boot mode | ⚠️ needs `tb_bootmode` | `pmic write` returns `-ENOSYS` on MT6328 (no byte ops); use `pmic_clrsetbits()`. The RTC driver is built but not instantiated by the grandpplte DTS. |
| Watchdog | ✅ driver exists (`WDT_MTK`, off in grandpplte) | Enable it with autostart; max timeout 15.98 s; section 5.8. |

---

## 8. GUI design

### 8.1 Options

| Option | When visible | Input | Pros | Cons | Phase |
|---|---|---|---|---|---|
| **Stage-1 initramfs chooser** | ~1 s after kernel, before rootfs | Touch (Goodix), Vol±/Power | Works when rootfs is broken; early; no X/Wayland; can reboot to Android | Needs a small static C program; no fancy UI | **1** |
| PocketJS boot tile | After Linux UI (~19 s) | Touch | Easy; looks native; can show status | Only when Linux already booted; not a recovery UI | 2 |
| Android QSTile / app | Android running | Touch | Convenient entry from Android | Needs root; not a boot-time GUI | 1–2 |
| U-Boot text menu | Before Linux | Vol±/Power | Works with a broken Linux | No display/keypad driver today; text only; extra port work | 3–4 |
| LK boot menu | Power-on | Vol±/Power | Stock, no code | Key combo unverified; text only; not our UI | fallback |

### 8.2 Stage-1 chooser

**Program:** `mainline/initramfs/bootmenu.c`, compiled static for aarch64 into the initramfs (same build as
`lkpaint`). It is a single-threaded `poll()` loop over:

- `/dev/fb0` (mediatekdrmfb or simpledrm; use `FBIOGET_VSCREENINFO`/`FBIOGET_FSCREENINFO`);
- `/dev/input/event*` (Goodix touch, `mt6779-keypad`, `mt6328-keys`);
- a 1 s timer for the countdown.

**Screen:** 600×1024 portrait, dark background, four large rows:

```
TB-7304X
Continue Linux    (default, 5)
Boot Android
Fastboot
Rescue shell
```

Use a built-in 8×16 bitmap font (no font files). Draw once, then only redraw the countdown/second. Touch: map
`ABS_MT_POSITION_X/Y` or `ABS_X/Y` to rows; a tap selects immediately. Keys: Vol+/Vol− move, Power selects
(or Vol− as OK if Power is awkward). Show the ledger's last result at the bottom ("last: linux, attempt 2,
init OK") for diagnosis. Unbind fbcon (or raise the kernel loglevel) while the menu is up so kernel messages do not
overdraw it; restore the console on exit.

**Timing:** start as soon as `/dev/fb0` and an input device exist; 5 s default (`tb.menu=0` disables, `tb.menu=10`
changes the timeout). On timeout, **continue the current boot**; `default_target` is information about the next cold
boot, not a command to reboot. Do not block USB/network setup: fork the menu after the gadget is up, or run it in
the foreground while the USB setup is already done.

**Actions:**

- **Continue Linux:** write `target=linux`, `boot_attempt=0`, `armed=1`, `seq++`, fsync; set the RTC recovery bits
  (so a crash before `healthy` returns to Linux); continue the current boot (no reboot, because the chooser only runs
  in Linux stage 1). If this is a rescue boot, continue to the rescue shell.
- **Android:** write `target=android`, `armed=0`, `seq++`, fsync; clear RTC; reboot.
- **Fastboot:** write `target=fastboot`, `armed=1`, `seq++`; set the RTC fastboot bit; reboot.
- **Rescue:** Phase 1 has no second stage to interpret `target=rescue`; skip the rootfs and drop to the initramfs
  shell immediately, without rebooting. From Phase 2, write `target=rescue`, `armed=1`, `seq++`, set the RTC
  recovery bits, and reboot so U-Boot can load the separate rescue kernel/initrd.
- **No input:** continue the current boot (do not reboot).

**Failure handling:** if the framebuffer or input device is missing, log and continue the boot after the timeout.
The menu must never be a single point of failure. If the ledger is unreadable, show "state unreadable" but continue
the current boot after the timeout: an unreadable ledger must not create a reboot loop. U-Boot (before Linux) is the
place that treats an unreadable ledger as "select Android".

**Why not PocketJS only:** PocketJS starts ~19 s after power-on and depends on the rootfs, DRM, and the kiosk
service. If any of those is broken, you cannot choose Android. The initramfs chooser is independent.

### 8.3 PocketJS tile

Add a "Boot" tile to the kiosk UI:

- shows the ledger's current default and last result;
- buttons: "Reboot to Linux", "Reboot to Android", "Fastboot", "Rescue";
- confirmation dialog (a mis-tap should not reboot);
- calls `tb-reboot` via a small local helper, not a shell injection.

This is convenience, not the boot path. It requires the kiosk to be running.

### 8.4 Android entry

A Magisk service or a tiny app with root:

- waits for `sys.boot_completed`;
- resets Magisk's bootloop counter (the existing `linux-test.sh` logic);
- writes the ledger and arms the RTC;
- reboots.

A Quick Settings tile is the nicest entry. A home-screen shortcut to a root script is enough for Phase 1. Do not
ship an app that reboots before boot completion.

### 8.5 U-Boot menu (later)

Only after simplefb and a keypad driver work. U-Boot's `bootmenu` can present a text menu on the panel; use
Vol+/Vol− and Power. This is a fallback for a broken Linux, not the primary GUI. It must not reinitialize the
display clocks; it writes into LK's live framebuffer.

---

## 9. Rootfs on microSD

### 9.1 Why

| Cache loop image | microSD |
|---|---|
| ~256 MB cap, shared with Android | card size, no Android interaction |
| Android may wipe cache / factory reset | removable, repairable on a PC |
| double journaling (ext4 in ext4) | single filesystem |
| no fsck in initramfs | fsck before mount |
| update deletes old image first | A/B slots, atomic switch |
| not a real installation | portable, backupable |

### 9.2 Layout

```
microSD (GPT or MBR):
  reserved 1 MiB        raw bootstate (two 512-byte copies) + rescue metadata
  p1  TBBOOT  128 MiB   FAT32: Image.gz/FIT, board.dtb, initramfs, boot.scr, bootstate.txt, rescue/
  p2  TBROOT_A 1 GiB    ext4 root A
  p3  TBROOT_B 1 GiB    ext4 root B
  p4  TBDATA   rest     optional shared data (exFAT/ext4)
```

- FAT is readable by U-Boot, Linux, Android (with a mount helper), and a PC. Keep the kernel/DTB/initrd there.
- A/B root partitions are independent ext4 filesystems; no loop image.
- The raw bootstate area is before p1 so it cannot be reformatted by a filesystem tool. Two copies + CRC.
- A rescue directory on FAT contains a known-good kernel/initrd and a `boot.scr` that never touches the rootfs.

### 9.3 Boot flow

1. U-Boot reads the raw bootstate (or `bootstate.txt` fallback).
2. Selects slot A/B; loads kernel/DTB/initrd from FAT.
3. Passes `root=PARTUUID=<slot>` and `rootwait rw`.
4. Stage 1 (initramfs) shows the menu, fsck the root partition, mounts it, writes `init`, `switch_root`.
5. Stage 2 writes `healthy`, runs the trial logic, and re-arms in Mode B.

### 9.4 A/B updates

1. Write the new rootfs to the inactive slot (`dd`/`rsync`/image).
2. Verify the image checksum and fsck the new slot.
3. Write a new ledger generation with `generation++`, `slot=inactive`, `trial=1`, `trial_attempt=0`,
   `target=linux`, `armed=1`; keep `last_good_slot` pointing at the currently working slot.
4. Reboot. Stage 2 reaches `healthy` after 60 s, sets `last_good_slot=slot`, and clears `trial`.
5. If the new slot fails to reach `init` N times (`boot_attempt`) or fails to reach `healthy` N times
   (`trial_attempt`), U-Boot restores `slot=last_good_slot`, clears `trial`, and records
   `last_error=trial_failed`. Do not assume the other slot is good: use the recorded `last_good_slot`, and if that
   also fails, select Android/rescue.
6. Never overwrite the active slot during an update.

For kernel/DTB updates: keep `kernel-a`/`kernel-b` (or FIT A/B) on FAT and select the matching pair. A kernel and
rootfs from different generations can be dangerous; store a `generation` in both the ledger and the FIT metadata.

### 9.5 fsck and rescue

- Add `e2fsck -p` (static aarch64) to the initramfs. Run it on the selected root partition before mount; if it
  returns a serious error, select the other slot or rescue.
- `e2fsck -y` only on an explicit rescue action, never automatically on a healthy slot.
- Rescue path: U-Boot loads `rescue/Image` + `rescue/initramfs` from FAT; the rescue initramfs mounts the SD
  read-only, exposes SSH/serial, and can repair or re-image a slot.
- A separate rescue SD card is the last line of defense; it is independent of the internal eMMC and the main card.

### 9.6 Migration

1. Build the SD layout on a PC.
2. Copy the current Alpine rootfs (`/cache/linux/rootfs.img`) into slot A with `rsync`/`tar` (not a raw image).
3. Boot with `tb.root=sd` or a one-shot U-Boot target; keep the cache image as a fallback.
4. Once the SD path is stable, make it the default and retire the cache image.
5. Keep a known-good SD image on the host.

---

## 10. Recovery ladder

| Level | Symptom | Action | Data loss |
|---|---|---|---|
| 0 | Linux running, need Android | `tb-reboot android` or the GUI | none |
| 1 | Linux hung, USB gadget alive | `mlsh.py` / SSH; sysrq `s,u,b`; `tb-reboot` | none |
| 2 | Linux hung, no USB | Hold Power ~15 s; if the RTC is armed the retry limit applies, otherwise LK boots Android | none |
| 3 | LK boots Android, need fastboot | Key combo for LK menu/fastboot (unverified) or Android `reboot bootloader` | none |
| 4 | LK fastboot works | `fb_send.py` restore `recovery`/`boot`; never flash `lk` casually | none if backups are current |
| 5 | U-Boot works, Linux broken | U-Boot fastboot `boot` a good image; U-Boot `ums 0 mmc 1` to expose the SD (never `mmc 0`) | none |
| 6 | U-Boot broken, LK fastboot broken | BROM: power off, hold Vol+ and Vol−, plug USB; `mtk w recovery ...` | none |
| 7 | eMMC/GPT damaged | BROM full restore from `backup/partitions` (never publish; IMEI) | depends on backup |
| 8 | SD corrupted | Boot rescue SD; re-image slots on a PC | SD data only |

Rules:

- **Never** write `lk`, `boot`, GPT, `userdata`, `metadata`, `nvram`/`nvdata`, `protect*`, or `para` as part of
  normal operation.
- Keep `backup/partitions/recovery.bin` (stock), the current mainline recovery, and the U-Boot recovery image on
  the host and on the rescue SD.
- Test the restore path before you need it. A backup that has never been restored is a hypothesis.
- BROM is the ultimate recovery. Keep the procedure (Vol+ + Vol−, USB) printed and the mtkclient venv working.

---

## 11. Test and fault-injection matrix

| # | Scenario | Expected | How | Pass |
|---|---|---|---|---|
| T1 | Cold boot, no request | Android | Power off/on 10× | Android every time; ledger says `android` |
| T2 | Android → Linux via helper | Linux | Helper + reboot | Linux; ledger `linux`, attempt counted |
| T3 | Linux → Android via `tb-reboot` | Android | Command | Android; RTC clear |
| T4 | Linux → Linux reboot | Linux | `tb-reboot linux` | Linux; no Android trip |
| T5 | Power loss during ledger write | One valid copy remains | Cut power at each write point (scripted) | Boots; `seq` consistent; no corruption |
| T6 | Rootfs image corrupt | Previous image or initramfs shell | `dd` random bytes into the image | Fallback; old image still boots |
| T7 | Rootfs update interrupted | Old image still bootable | Kill power during gunzip/rename | Old image boots; new one is `.new`/discarded |
| T8 | `cache` full | Clear error, no brick | Fill cache, try update | Update aborts; current boot unaffected |
| T9 | Kernel/DTB bad (no init) | Android after N tries (Phase 2) | Flash a bad kernel to cache/U-Boot target | `boot_attempt` increments; Android at max; Phase 1 gets one attempt (F8) |
| T10 | Linux hangs before init | Retry then Android (Phase 2) | `panic`/hang test image | U-Boot retries; RTC clear on last try; Phase 1 gets one attempt |
| T11 | Linux hangs after init | Health counter; no boot-loop | Kill stage 2 | `trial_attempt` increments; Android after N, or `last_good_slot` for a trial generation |
| T12 | U-Boot hangs | Watchdog reset + ledger fallback | Hang before and after `tb_bootmode` | Before arming: Android on the next reset. After arming: N retries, then Android. Manual LK fastboot works. |
| T13 | U-Boot corrupt | LK fastboot/BROM restore | Flash random bytes to recovery | Restore via `fb_send.py`/BROM; `boot` intact |
| T14 | U-Boot `fastboot boot` | Linux from RAM | `fastboot boot` a good image | Stage 1/SSH; no flash write |
| T15 | U-Boot `fastboot flash` disabled | Command rejected | `fastboot flash recovery` | No write; clear error |
| T16 | SD removed | Android/rescue, no hang | Pull card at boot | Bounded timeout; Android/rescue |
| T17 | SD slot A corrupt | Slot B or rescue | Corrupt A | B boots; ledger marks A bad |
| T18 | SD update interrupted | One slot intact | Cut power during write | A or B boots; no data loss on the other |
| T19 | GUI touch/keys | Selection works | Tap/Vol±/Power | Correct target; timeout works |
| T20 | GUI display missing | Boot continues | Disable fb/input | Timeout; continue the current boot |
| T21 | Ledger unreadable | Safe default | Corrupt both copies | U-Boot selects Android; stage 1 logs and continues, no loop |
| T22 | Android boot loop/Magisk | No safe mode | Reboot before `boot_completed` | Helper waits/resets; Android boots |
| T23 | Low battery | Android/charge | Drain battery, boot | Android/charge policy; no Linux-only hang |
| T24 | BROM restore drill | Full restore | mtkclient on a spare/backup | Device boots Android; IMEI intact |
| T25 | 100/500 boot soak | No drift | Scripted reboot loop | Ledger consistent; no partition wear errors |
| T26 | Charger plugged into an off tablet with the RTC armed | Documented, safe | Arm, power off, plug USB | Record KPOC vs `recovery`; either way no loop, and the tablet charges |
| T27 | Kernel hang before `mtk_wdt` probes (Phase 2) | Watchdog reset, counted | Test kernel that spins in `start_kernel` | Reset within ~16 s; `boot_attempt` increments; Android at the limit |
| T28 | Stage 2 hangs without crashing | Health deadline reboots | `kill -STOP` the kiosk / block `healthy` | Reboot at the deadline; `trial_attempt` increments; rollback/Android after N |
| T29 | `recovery` reflashed | Ledger survives (or resets safely) | `fb_send.py` a new image | Same `seq` afterwards, or "no state" → Android; never a bad target |

Fault injection needs a controllable power source (USB switch) and a host script that records the ledger before
and after each boot. Do not run destructive tests on the only known-good device without a current BROM backup.

---

## 12. Risks and rollback

### 12.1 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| U-Boot cannot be chainloaded by this LK | medium | Phase 2 blocked | Spike first; `bootshim` contingency; keep current recovery |
| U-Boot memory map corrupts the framebuffer/ATF/pstore | medium | display/crash logs lost | Reserve regions; `SYS_MEM_TOP_HIDE`; verify `/proc/iomem`; one variable at a time |
| U-Boot RTC write clears other `PDN1` bits | medium | wrong boot target / alarm | Use `pmic_write_u32` + read-modify-write; test `status`; keep a backup |
| A U-Boot that starts and hangs after arming the RTC loops in recovery | medium | tablet unusable without keys/BROM | Ledger attempt limit; U-Boot watchdog; test LK fastboot/BROM restore before flashing. A corrupt U-Boot that never starts leaves the RTC clear, so the next reset boots Android. |
| Ledger corruption | low | wrong target/default | Two raw copies + CRC + `seq`; one shared parser (`tbstate`/`tb_select`); safe Android default |
| U-Boot damages Android's `cache` fs | low (after the fix) | Android cache errors | `EXT4_WRITE` off; U-Boot only reads `cache` |
| Hang with no reset | medium | counters never advance; manual long press | U-Boot-armed watchdog + stage-1 health deadline (section 5.8) |
| Rootfs update loses the working image | medium | Linux unbootable | Keep old image/slot; verify before rename; never delete first |
| SD card wear/failure | medium | Linux unbootable | A/B, fsck, rescue SD, backups |
| Android cache wipe | medium | cache rootfs lost | SD rootfs; keep image on host |
| Magisk bootloop | medium | Android unusable | Wait for `boot_completed`; reset counter; helper |
| Low battery during Linux | medium | data loss/hang | SM5414 status check or a power driver; low-battery target Android; autoreboot |
| Display format wrong in U-Boot | high (if menu) | wrong colours, not a brick | Test simplefb separately; keep U-Boot headless initially |
| Key combo unknown | high | manual recovery harder | Verify in Phase 0; BROM always works |
| `para` write corrupts Android BCB | low | Android recovery/OTA issues | Read-only until verified; full backup; never write casually |

### 12.2 Forbidden writes

Do not write these as part of this plan, except `recovery` intentionally:

```
lk  boot  preloader  seccfg  GPT  userdata  metadata  nvram  nvdata  protect1  protect2  para
```

`recovery` is the only internal partition this plan writes raw (boot image + ledger tail). `cache` is written as
files by Android and Linux (rootfs, kernel files), never by U-Boot, and is never reformatted. `misc`/`para` is read-only until the BCB test is understood.

### 12.3 Rollback per phase

| Phase | Rollback |
|---|---|
| 0 | none needed |
| 1 | restore the previous `recovery` image; zero the ledger tail (`tbstate wipe`); Android untouched |
| 2 | `fb_send.py backup/partitions/recovery.bin flash:recovery` (stock) or the previous mainline image; boot Android |
| 3 | boot the cache image or the previous SD slot; re-image the card on a PC |
| 4 | clear the persistent arm; restore stock `recovery`; if `lk` was replaced, restore `lk.bin` via BROM |

---

## 13. Verification checklist

Mark each item ✅/⚠️/❌ with the date and evidence. Do not start a phase whose blocking items are ⚠️.

### Before Phase 1

1. ✅/⚠️ `recovery.bin` backup is 16 MiB and restores (test on a spare or with a known-good image).
2. ⚠️ LK menu key combo: test Power+Vol Up, Power+Vol Down, Vol+ + Vol−, and Power alone; record the exact combo.
3. ⚠️ BCB: dump `para` before/after `adb reboot recovery`; does LK honor `boot-recovery`? Do not write it.
4. ⚠️ Watchdog: does LK leave TOPRGU armed? Test by hanging the kernel before `mtk_wdt` probes; does it reset?
5. ⚠️ Actual `cache` size/free space and whether Android wipes it on recovery/factory reset.
6. ⚠️ `sys.boot_completed` timing and Magisk counter behaviour on this unit.
7. ⚠️ Current `tb-reboot` targets all work after 10 cycles.
7a. ⚠️ A reflash of `recovery` with `fb_send.py` leaves the last 64 KiB intact, and Android does not rewrite
    `recovery` at boot.
7b. ⚠️ Charger-plug cold boot with the RTC armed: KPOC or `recovery`? (T26)

### Before Phase 2

8. ⚠️ A tiny AArch64 payload at `0x40080000` is accepted by LK and runs (sign of life: U-Boot fastboot device).
9. ⚠️ LK accepts the gzip + appended-DTB U-Boot payload; U-Boot uses its built-in DT, and the LK-patched DT in
   `x0` is saved and readable (`fdt addr ${prevbl_fdt_addr}; fdt print /memory`).
10. ⚠️ LK's real memory carveouts are known from the current boot's `/proc/iomem`; any MD/CCCI/CONSYS range LK
    withholds is reserved in the U-Boot and Linux DTs, together with ATF, pstore/ram_console/minirdump, and the
    framebuffer.
11. ⚠️ U-Boot `TEXT_BASE=0x40080000` build boots; `bdinfo` relocation address is below `0x7f000000`.
12. ⚠️ `fastboot boot` of a known-good image reaches stage 1/SSH; no flash write.
13. ⚠️ `tb_bootmode` writes `RTC_PDN1` without clearing unrelated bits; verify with `status` and a reboot.
14. ⚠️ U-Boot reads the ledger from cache; a missing/corrupt ledger falls back to Android; a previous
    `last_stage=init` increments `trial_attempt`, and after N the fallback happens.
15. ⚠️ A U-Boot hang resets via watchdog and the ledger selects Android after N attempts. A kernel hang before
    `mtk_wdt` probes also resets (T27).
15a. ⚠️ `booti` reports no relocation (kernel at `0x40200000`), and the Image's `image_size` ends below
    `0x43000000`.
16. ⚠️ LK fastboot restore of `recovery` works after U-Boot is installed.
17. ⚠️ U-Boot `fastboot flash` is disabled (or allowlisted) and cannot write `boot`/`lk`.

### Before Phase 3

18. ⚠️ `msdc1` works in mainline (card detect, UHS, read/write) and in U-Boot (`mmc dev 1`, `fatload`) with the
    `vmch`/`vmc` supplies (not grandpplte's `vdd_tflash`).
19. ⚠️ SD power regulators (`vmch`/`vmc`) are correct and survive suspend/resume.
20. ⚠️ fsck runs before mount; a corrupt ext4 is detected and falls back.
21. ⚠️ A/B update/rollback works with power loss at each step.
22. ⚠️ Rescue SD boots independently of the internal eMMC.

### Before Phase 4

23. ⚠️ 500-boot soak with no ledger drift or partition errors.
24. ⚠️ BROM restore drill succeeds from a deliberately broken `recovery`/`lk`.
25. ⚠️ Android re-arms the RTC reliably and does not boot-loop.
26. ⚠️ Low-battery/power-loss policy selects Android/charge, not a Linux retry loop (requires the power driver or
    the SM5414 status check).
27. ⚠️ The user has explicitly accepted the risk of replacing `lk` (if that option is chosen).

---

## 14. References

Repository:

- `docs/mainline/STATUS.md` — current hardware/software status, measurements, todo.
- `docs/mainline/research-rootfs.md` — cache loop-image design, partition constraints, Alpine build.
- `mainline/README.md` — LK constraints, display/SMP findings, current boot flow.
- `mainline/TEST-PLAN.md` — tested flash/boot flow, `fb_send.py`, safe Android exit, RTC flags.
- `mainline/initramfs/init` — stage-1 bootcounter/switch_root/fallback logic.
- `mainline/patches/mtk-rtc-boot-mode.c` — RTC `next_boot` driver.
- `mainline/rootfs/overlay/usr/local/sbin/tb-reboot` — current OS switch command.
- `mainline/scripts/linux-test.sh` — host boot/reboot helpers and Magisk counter safety.
- `mainline/scripts/build-in-docker.sh` — kernel/initramfs/boot image packaging, 99-char and 16 MiB limits.
- `mainline/dts/mt6737m-lenovo-tb7304x.dts` — board DTS.
- `mainline/stock/stock.dts` — stock DTB, partitions, msdc1, PMIC.
- `docs/ONBOARDING.md` — BROM/mtkclient backup/unlock, Magisk, repo map.
- `LOG.md` — historical boot experiments.

U-Boot:

- `https://gitlab.com/mt6735-mainline/u-boot` — MT6735 port, branch `mt6735-staging`, commit
  `3d74bf168618b78567c31b3f4ec96430f3b565c8`, U-Boot 2023.04-rc1.
- `configs/grandpplte_defconfig` — the chainloaded (non-SPL) reference.
- `arch/arm/dts/mt6737t-samsung-grandpplte.dts`, `arch/arm/dts/mt6735-common.dtsi`, `arch/arm/dts/mt6735.dtsi`.
- `drivers/fastboot/fb_common.c` — `fastboot boot` implementation (`bootm`/`fastboot_bootcmd`).
- `boot/image-android.c` — Android boot image parsing; does not extract an appended DTB.
- `disk/part.c` — `blk_get_device_part_str()` accepts numeric partition IDs, not names.
- `cmd/bcb.c` — `bcb load <dev> <part>` accepts a partition name (`para` on this device).
- `drivers/rtc/mt6328-rtc.c` — MT6328 RTC driver (does not expose `PDN1` boot bits).
- `drivers/power/pmic/pmic_mt6328.c`, `drivers/power/pmic/pmic-uclass.c` — 16-bit `pmic_write_u32` path.
- `drivers/video/simplefb.c`, `drivers/video/Kconfig` — `VIDEO_SIMPLE`, `VIDEO_DT_SIMPLEFB`.
- `cmd/Kconfig` — `CMD_BCB`, `CMD_BOOTMENU`, `CMD_USB_MASS_STORAGE`.
- `drivers/watchdog/mtk_wdt.c` — MTK watchdog; timeout clamped to 15984 ms.
- `arch/arm/lib/image.c` — `booti_setup()`: 2 MiB alignment / relocation.
- `fs/ext4/ext4_write.c` — `ext4fs_write()`: delete + recreate, refuses `metadata_csum` and hash-tree dirs.
- `drivers/power/pmic/pmic_mt6328.c`, `pmic-uclass.c` — only `read_u32`/`write_u32`; `pmic_clrsetbits()`.

MediaTek background:

- `https://www.lieberbiber.de/?p=149` — MediaTek LK background.
- MTK LK/Preloader sources and the MT6328 RTC `RTC_PDN1` definitions (bits 4–5 recovery, bit 13 fastboot).
- Android `bootloader_message` / BCB layout (`bootable/recovery/bootloader.h`).

---

## Appendix A — `bootstate` text form

This is the output of `tbstate dump` and the format of the human-readable copies (status page, FAT `bootstate.txt`).
It is the storage format only in the text-file fallback of section 5.4:

```
magic=TBBS
version=1
seq=42
generation=7
slot=a
last_good_slot=a
target=linux
default_target=android
flags=armed,trial
boot_attempt=1
max_boot_attempts=3
trial_attempt=0
max_trial_attempts=3
last_target=linux
last_stage=healthy
boot_reason=reboot
last_generation=7
last_error=none
kernel_sha256=...
rootfs_sha256=...
crc32=...
```

Every write increments `seq`; a new generation also resets `trial_attempt`. In the fallback, alternate between
`bootstate` and `bootstate.bak`, writing the copy with the lower `seq` via `.tmp` + `rename`; a reader takes the
valid copy with the higher `seq`. U-Boot only reads these files, with a C parser and a real CRC32 check, never
`env import -t`.

## Appendix B — What not to do

- Do not flash `boot` with a Linux image. Magisk and Android live there.
- Do not replace `lk` before Phase 4 and a tested BROM restore.
- Do not write `para`/`misc` until the BCB test is understood.
- Do not enable U-Boot `fastboot flash` by default.
- Do not let the boot manager delete the last working rootfs/kernel.
- Do not make Linux the cold-boot default while the only recovery is a key combo you have not verified.
- Do not depend on the RTC bit as the only record of intent.
- Do not run destructive tests without a current BROM backup and a known-good `recovery` image.
