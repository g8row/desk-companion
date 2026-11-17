# TB-7304X dual boot: the decided design (Linux by default, Android one step away)

**Date:** 2026-11-17. **Status:** decided. **Live layout since 2026-11-17 12:46: U-Boot in `boot`, Android in `recovery`** (T3 passed). Repartitioning not started.
**Supersedes:** the U-Boot placement, ledger location, GUI actions and rootfs sections of
[plan-boot-recovery.md](../../plan-boot-recovery.md), and the long-term layout of [research-rootfs.md](research-rootfs.md).
**Evidence:** [research-lk-bootflow.md](research-lk-bootflow.md) (stock LK, disassembled, with addresses).

Decisions taken with the user on 2026-11-17:
- **No microSD.** Everything lives on the internal eMMC.
- **Wiping Android's data once is acceptable.** It holds 423 MB; Magisk needs re-setup afterwards.
- U-Boot goes in `boot` and autoboots Linux. Android moves to `recovery`.
- The boot menu (GUI) lives in Linux's stage-1 initramfs.

---

## 1. Boot chain

```
BROM → preloader → LK (stock, never modified)
  │  LK checks, in this order (lk.bin 0x41e02c60): RTC fastboot bit, RTC recovery bit, BCB, Vol+ menu, KPOC
  ├─ default: cold power-on, reboot, alarm, charger plug-in (KPOC)
  │     → boot = U-Boot (padded image, research-lk-bootflow §4)
  │          reads LK's bootmode (atag,boot) and tbstate (§4)
  │          ├─ KPOC (8/9) or alarm (7)      → Android from `recovery` (stock charging UI / alarm)
  │          ├─ tbstate: android-once         → Android (tbandroid: LK's DT, bootmode and firmware/android/mode = normal)
  │          ├─ tbstate: fastboot             → U-Boot fastboot (`fastboot boot` from RAM, development)
  │          └─ default: Linux slot A/B       → kernel slot (raw), boot counter; failures → other slot → rescue → Android
  ├─ RTC recovery bit (one-shot, cleared by LK before loading) or Vol+ menu → Recovery
  │     → recovery = Android + Magisk, started by LK directly, U-Boot not involved (runs with ro.boot.mode=recovery)
  └─ RTC fastboot bit or Vol+ menu → Fastboot → LK fastboot (`mainline/scripts/fbusb`: flash boot/recovery)
```

Properties this gives:
- **Linux by default** with no RTC re-arming.
- **Two ways to Android that bypass U-Boot:** the Vol+ menu (needs no software at all) and the RTC bit (one-shot,
  self-healing). A corrupt, hung or bad U-Boot costs at most one menu press.
- **No BCB, ever.** LK never clears it, and it hides the volume menu.
- **Android in normal mode** whenever U-Boot starts it.

## 2. eMMC layout

The eMMC is 14910 MiB (last LBA 30535679). The GPT has **23 entries**. Every existing partition keeps its start LBA;
only the end of `userdata` moves. LK reads up to 128 entries (`calloc(0x81, 0x14)` at `0x41e04dcc`) and never
writes the GPT. The preloader's GPT parsing is **not analysed**; the fallback is BROM writing back
`backup/partitions/gpt.bin` and `gpt_backup.bin`.

| # | Name | Start LBA | End LBA | Size | Content | Written by |
|---|---|---|---|---|---|---|
| 1–6 | proinfo … para | — | — | — | stock, untouched (`para` never written) | nobody |
| 7 | `boot` | 60416 | 93183 | 16 MiB | **U-Boot** (padded, gated by `lk_image_check.py`) | host, via LK fastboot or Android/Linux `dd` |
| 8 | `recovery` | 93184 | 125951 | 16 MiB | **Android + Magisk** boot image | host / Magisk |
| 9–21 | logo … cache | — | — | — | stock; `cache` is Android's again once `/cache/linux` is retired | Android |
| 22 | `userdata` | 10207232 | **16498687** | **3072 MiB** (was 9909) | Android, force-encrypted | Android |
| 24 | `tbstate` | 16498688 | 16500735 | 1 MiB | raw boot record, two copies + CRC (§4) | **the only thing U-Boot writes**; Linux, Android tile |
| 25 | `tbkern_a` | 16500736 | 16631807 | 64 MiB | raw kernel slot A: Android-format image (Image.gz, DTB in `second`, initramfs + menu) | Linux updater |
| 26 | `tbkern_b` | 16631808 | 16762879 | 64 MiB | raw kernel slot B | Linux updater |
| 27 | `tbrescue` | 16762880 | 16893951 | 64 MiB | raw known-good rescue kernel + initramfs | written once, by hand |
| 28 | `tbroot_a` | 16893952 | 21088255 | 2048 MiB | ext4 root A | Linux updater |
| 29 | `tbroot_b` | 21088256 | 25282559 | 2048 MiB | ext4 root B | Linux updater |
| 30 | `tbdata` | 25282560 | 30501887 | 2548.5 MiB | ext4: `/home`, persistent `/var/lib`, logs, pstore copies | Linux |
| 23 | `flashinfo` | 30501888 | 30534655 | 16 MiB | stock, untouched | — |

Notes:
- **Raw kernel slots:** U-Boot only needs `mmc read` and a checksum, so there is no filesystem code on the boot
  path. The image format is the one `fastboot boot` already uses (`boot-mainline-uboot.img`). U-Boot checks the
  header's SHA-1 `id` before booting it.
- **Root filesystems:** plain ext4, so `e2fsck -p` can run in the initramfs before mounting. No loop file, no
  double journaling.
- **Entry numbers:** new entries are appended (24–30). Existing numbers keep their `mmcblk0pN` names, so Android's
  `by-name` links and fstab are unaffected. Type GUIDs: Linux filesystem (`0FC63DAF-…`) for the ext4
  partitions, Linux data for the raw ones. Names are ≤ 36 characters (LK copies at most 36, `0x41e052bc`).
- **Survives Android:** a factory reset formats only `userdata` and `cache`, so every `tb*` partition survives.

## 3. Who may write what

| Writer | May write | Must never write |
|---|---|---|
| LK | nothing on the eMMC in our flows (RTC bits only) | — |
| U-Boot | `tbstate` | everything else (no `fastboot flash`, no ext4/FAT write, enforced by `build-uboot.sh`) |
| Linux | `tbstate`, inactive `tbkern_*`/`tbroot_*`, `tbdata`; `boot`/`recovery` only by explicit admin command | `para`, Android partitions |
| Android | `recovery` (Magisk updates), `tbstate` (from the "boot Linux/Android" tile) | everything `tb*` except `tbstate` |
| Host | anything, via LK fastboot (`fbusb`) or BROM | — |

## 4. `tbstate` boot record

Two 512-byte copies at offsets 0 and 64 KiB. Each copy holds magic, version, generation, CRC32, and:

`default_target` (linux/android) · `oneshot_target` (none/android/fastboot/rescue/slot-a/slot-b, cleared by U-Boot
when it acts) · `slot` (a/b) · `last_good_slot` · `boot_attempt` · `trial` · `last_stage` (uboot/kernel/init/healthy)
· `last_error`.

- **Reading:** U-Boot takes the copy with the highest generation and a valid CRC. If neither copy is valid, it boots
  Android.
- **Writing:** the writer updates the older copy first, then the newer one, so one valid copy always survives a power
  loss.
- **Counting attempts:** U-Boot increments `boot_attempt` before booting Linux. Stage 2 writes
  `last_stage=healthy` and resets it to 0 after 60 s. At N = 3 failed attempts, U-Boot tries `last_good_slot`, then
  rescue, then Android, and records `last_error`.
- **Cover for early hangs:** the watchdog. LK leaves 10 s armed, U-Boot reprograms 15 s, and Linux `mtk_wdt` takes
  it over. A kernel that hangs before stage 1 still resets, and the count advances.

## 5. Boot menu (GUI)

The menu is a static C program in the stage-1 initramfs, drawing to `/dev/fb0` and reading `/dev/input/*` (Goodix
touch, keypad Vol±, `mt6328-keys` Power). It runs on every Linux boot with a 5 s countdown. The design is
plan-boot-recovery §8.2, with these corrections for this layout:

| Action | Does | Reboot? |
|---|---|---|
| Continue Linux (default, timeout) | carry on | no |
| Linux slot A / B / rescue | `kexec` the kernel from the chosen raw slot (`CONFIG_KEXEC=y`) | no |
| Android | `oneshot_target=android` in `tbstate`, reboot → U-Boot → Android in normal mode | yes |
| Android (U-Boot broken) | set the RTC recovery bit, reboot → LK boots `recovery` directly | yes |
| Fastboot | `oneshot_target=fastboot` (U-Boot) or the RTC fastboot bit (LK) | yes |

- **Do not set the RTC recovery bit on "Continue Linux".** Plan §8.2 said to, but in this layout the bit means
  Android.
- **Android can't be kexec'd.** Its 3.18 kernel depends on LK's DT handoff, so choosing Android always costs a reboot.
- **The menu never causes a reboot on failure.** A missing framebuffer or input device, or an unreadable record,
  means: wait out the timeout, then continue.
- **Getting back to Linux from Android is a plain reboot:** U-Boot's default is Linux. A Quick Settings tile only
  resets Magisk's boot-loop counter and reboots.
- Later, optionally: a U-Boot text menu with the volume keys. That needs a PMIC/keypad driver in U-Boot and is not
  required.

## 6. Migration (one session, after §8 passes)

Escape for every step: Vol+ menu → Recovery/Fastboot; BROM + mtkclient with `backup/partitions/*` (GPT, boot,
recovery, para).

1. **Back up everything.** Fresh dumps: GPT (primary and backup), `boot`, `recovery`, `metadata`, `para`, and
   `/cache/linux/rootfs.img`. Take a tar of the Alpine root as files.
2. **Layout swap (T3, §8).** U-Boot to `boot`, Android to `recovery`. Live with it for at least a day before
   repartitioning.
3. **Write the new GPT**, both primary and backup. Only `userdata`'s end LBA changes, plus entries 24–30 and the
   entry count. Write it from mainline Linux with `sgdisk`, or with mtkclient from BROM. Reboot, then check LK and
   Android still start. Android will refuse the oversized encrypted `userdata`; that is expected.
4. **Wipe `userdata`:**
   1. Put the stock `backup/partitions/recovery.bin` into `recovery` once.
   2. Boot it with the RTC bit and run "Wipe data/factory reset". That formats `userdata` at its new size and clears
      the encryption footer in `metadata`.
   3. Put Android back into `recovery`.
   4. On first boot Android re-encrypts. Reinstall the Magisk app and finish its setup. Check `ro.crypto.state` and
      root.
5. **Format and fill the Linux partitions** from Linux: `mkfs.ext4` the roots and `tbdata`. Copy the Alpine root from
   the loop file into `tbroot_a` as files. Write the kernel image to `tbkern_a` and the rescue image to `tbrescue`.
   Write the first `tbstate`.
6. **Switch U-Boot's script** from `/cache/linux/boot-target` to `tbstate` and the raw slots. Keep `/cache/linux` as
   a fallback until A/B has worked for a week, then delete it.

## 7. Updates

1. Write the new kernel and root into the **inactive** slots, verify the checksums, and `e2fsck -n` the new root.
2. In `tbstate`: `slot=inactive`, `trial=1`, `boot_attempt=0`, `generation++`.
3. Reboot. Stage 2 reaching `healthy` sets `last_good_slot`. N failures roll back to `last_good_slot`.
4. Never write the active slot. `tbrescue` is never touched by updates.

## 8. Validation status

| Test | Layout | Result |
|---|---|---|
| T0 (old image, U-Boot-launched Android + 2.5 GB read, `adb reboot recovery`) | Android `boot`, old U-Boot `recovery` | ✅ reproduced: no U-Boot, `wdt_by_pass_pwk`, Android back on its own (2026-11-17 12:35) |
| T0a (old image, **LK**-launched Android + 1.5 GB read) | same | U-Boot started. That kernel keeps its DTB at `0x4e000000` protected, so heavy I/O alone is not enough. |
| T1 (padded image, same sequence as T0) | Android `boot`, padded U-Boot `recovery` | ✅ U-Boot fastboot after 13 s (12:39) |
| Mode fix (`tbandroid` sets `/firmware/android/mode`) | same | ✅ Android `rtc`, `ro.boot.mode=normal`, Magisk OK (sha256 `672f2f9a…`) |
| T2 Vol+ menu → Recovery with padded U-Boot | same | pending (needs hands) |
| **T3** padded U-Boot in `boot`, Android in `recovery` | swap (done 12:46, both verified with `cmp`) | ✅ T3a: 1.5 GB read, then `adb reboot` → Android from `recovery`, `mode=normal`, Magisk + encryption OK. ✅ T3b: power off, then Power on → U-Boot → Android normal (seen by the user) |
| T4 Linux by default from `boot` (`fastboot boot`, then the cache image) | swap | pending |
| T5 charger plugged while off (KPOC) | swap | ✅ Power-off with USB attached → LK charger mode → U-Boot → Android `kpoc_charger` from `recovery`. The screen is off at first (the charger blanks it). A short press on Power shows the battery animation (display resume, `bootlogo_show_charging`, backlight 150; confirmed by the user). It charges (CC 650 mA), and a long press on Power boots normally. |
| T6 Magisk direct-install target with Android in `recovery` | swap | pending |

### How to reach each target in the current layout (`boot` = U-Boot, `recovery` = Android)

| Want | Do | Path |
|---|---|---|
| Android, normal mode (default today: no `boot-target` file) | power on, `adb reboot` | LK → U-Boot → `tbandroid` from `recovery` |
| U-Boot fastboot (`fastboot boot <img>`) | `echo target=fastboot > /cache/linux/boot-target`, reboot. Leave with `fastboot reboot`; remove the file afterwards. | LK → U-Boot |
| Linux from `/cache/linux/boot-mainline-uboot.img` | `target=linux` in `boot-target` | LK → U-Boot → `bootm` |
| Android **without U-Boot** (escape) | `adb reboot recovery`, LK `oem reboot-recovery`, `tb-reboot recovery`, or Vol+ menu → Recovery | LK → `recovery`, `ro.boot.mode=recovery` |
| LK fastboot (`fbusb … flash:`) | `adb reboot bootloader` or Vol+ menu → Fastboot | LK |

`mainline/scripts/linux-test.sh` and `tb-reboot` still assume the old layout, where `recovery` meant Linux. Their
`recovery` targets now reach Android. Update them in T4.

Known U-Boot bug: **`fastboot continue` resets the tablet** (preloader within 2 s) instead of booting Android.
Use `fastboot reboot` until it's fixed.

## 9. Open questions

- Why the BCB run and P2b failed (research-lk-bootflow §5). Neither route is used in this design.
- The preloader's GPT handling (test step 6.3, with BROM ready).
- The physical key behind LK's factory key (code 1).
