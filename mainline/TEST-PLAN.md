# TB-7304X mainline — test plan for the main session

Everything here runs from the `mainline/` folder. Images are in `out/`.

| Image | What it is | Why |
|---|---|---|
| `out/boot-stock-kernel-initramfs.img` | **stock 3.18 kernel + stock DTB**, our busybox initramfs | Control: proves the boot path, the initramfs and the "sign of life" checks. |
| `out/boot-mainline.img` | mainline 7.0.10 (mt6735-mainline) + `mt6737m-lenovo-tb7304x.dtb` + same initramfs | The real test. |
| `out/boot-mainline-noovl.img` | same as above with `lkfb.ovl=0` | Use if `boot-mainline.img` hangs instantly: the framebuffer shim then skips reading display registers. |

All three use the stock header layout: v0, page 2048, base 0x40000000, kernel 0x40080000, ramdisk 0x44000000,
tags 0x4e000000, cmdline starting with `bootopt=64S3,32N2,64N2`.

## Important: `fastboot boot` is probably NOT available

We disassembled the stock LK (`backup/partitions/lk.bin`). Its fastboot command table registers only:
`getvar:`, `download:`, `flash:`, `erase:`, `continue`, `reboot`, `reboot-bootloader`,
`oem p2u`, `oem reboot-recovery`, `oem append-cmdline`, `oem off-mode-charge`. There is **no `boot`** command.
So `fastboot boot x.img` should fail with `FAILED (remote: 'unknown command')`. Nothing is written when that happens.
Step 1 checks this; it costs nothing.

If step 1 fails as expected, the only way to run these images without touching `boot` is to **flash the
`recovery` partition** and boot it once with `fastboot oem reboot-recovery` (step 3). That **writes flash**
(recovery only). `boot` (Magisk + Android) is never touched, and stock recovery is backed up in
`../backup/partitions/recovery.bin` (16 MiB raw). **Get the user's OK before step 3.**

## 0. Before you start

- **Battery above 50 %**, USB cable to the Mac. The mainline kernel has **no charger driver** (SM5414),
  so do not leave it sitting in a hung state on a low battery.
- Check the recovery backup: `ls -l ../backup/partitions/recovery.bin` (16777216 bytes).
- Optionally, record the Mac's USB devices: `ioreg -p IOUSB -w0 | sed 's/@.*//' > /tmp/usb-before.txt`.

## 1. Does LK accept `fastboot boot`? (RAM only, harmless)

```sh
adb reboot bootloader            # wait for the "FASTBOOT mode" screen
fastboot devices
fastboot boot out/boot-stock-kernel-initramfs.img
```

- `FAILED (remote: 'unknown command')` (expected): go to step 3 (with the user's OK) or stop.
  Get back to Android with `fastboot reboot`.
- It boots: great, our analysis was wrong. Use `fastboot boot` for everything in step 3 instead of
  flash + `oem reboot-recovery`, and skip the restore step.

## 2. What success looks like (applies to every image)

Timeline after the kernel starts:

1. **Screen:** red (2 s), then green (2 s), then blue. On the mainline image a penguin logo and kernel text
   (fbcon) should also appear on top. Red/green/blue may come out in other colours if the pixel format guess is off.
   That still counts as success.
2. **USB:** within ~10 s the Mac sees a **new USB device: `TB-7304X mainline 7.0.10-tb7304x`** (mainline) or
   `TB-7304X stock-kernel initramfs` (control), vendor `0x1d6b`, product `0x0104`, serial `TB7304X-mainline` / `TB7304X-stock`.
   ```sh
   ioreg -p IOUSB -w0 | grep -i -E 'TB-7304X|1d6b'
   system_profiler SPUSBDataType | grep -A8 -i 'TB-7304X'
   ls /dev/cu.usbmodem*                         # CDC-ACM serial shell
   ifconfig | grep -B3 172.16.42                # CDC-ECM (mainline) / RNDIS (stock; macOS may ignore RNDIS)
   ```
3. **Shell / logs:**
   ```sh
   screen /dev/cu.usbmodem* 115200              # root shell on the tablet (press Enter); quit: Ctrl-A K
   # ECM network: the tablet runs a DHCP server handing out 172.16.42.2. If macOS does not configure it:
   #   sudo ifconfig enX 172.16.42.2 netmask 255.255.255.0   (enX = the new interface)
   curl http://172.16.42.1/init.log
   curl http://172.16.42.1/dmesg.txt  > logs/dmesg-mainline.txt
   curl http://172.16.42.1/status.txt > logs/status-mainline.txt
   ```
   Save them under `mainline/logs/`. The `lkfb:` lines in dmesg give the real framebuffer address, OVL format and
   LCM name. They are the key data for the next iteration.
4. **To keep it running longer** than the 300 s auto-reboot: in the serial shell, `touch /tmp/stay`.
   To reboot now: `reboot -f`.

Partial success is still useful: screen colours with no USB means the kernel and initramfs run and musb needs work.
USB with no colours means the display path needs work.

## 3. Run the images (needs the user's OK: writes the recovery partition)

### 3a. Control (stock kernel)
```sh
adb reboot bootloader
fastboot flash recovery out/boot-stock-kernel-initramfs.img
fastboot oem reboot-recovery
```
Observe as in step 2. On the stock kernel the screen is driven by `mtkfb` (`/dev/graphics/fb0`), and USB uses
`android_usb` (ACM + RNDIS). The tablet reboots itself after 300 s, and LK then boots `boot` (Android) normally.

If the control image does not boot or shows nothing, **stop**. Mainline will not do better, and the boot path itself
needs investigating (for example, LK may refuse a recovery image whose ramdisk is not Android's).

### 3b. Mainline
```sh
adb reboot bootloader
fastboot flash recovery out/boot-mainline.img
fastboot oem reboot-recovery
```
If the screen freezes on the LK logo or "orange state" and nothing appears on USB within ~60 s, try
`out/boot-mainline-noovl.img` the same way.

### 3c. Restore stock recovery (always do this at the end)
```sh
adb reboot bootloader            # or: hold Vol-Down while powering on (unverified key combo)
fastboot flash recovery ../backup/partitions/recovery.bin
fastboot reboot
```

## 4. If it hangs — how the tablet recovers

In order of what should happen with no hands:

1. **Panic:** the cmdline has `panic=10 oops=panic`. A panic reboots after 10 s. This needs the mainline
   `mtk_wdt` restart handler, which is in the kernel and probes from the DT `toprgu` node.
2. **Init's own timer:** after 300 s init runs `reboot -f`. Before that it opens `/dev/watchdog` without
   ever petting it, so if `reboot -f` hangs the hardware watchdog resets the SoC (DT timeout 10 s).
3. **Early hang (before the watchdog driver probes):** if LK left the MTK hardware watchdog running, it
   resets the SoC by itself (typically within ~30 s). **Unverified:** we did not prove from the LK binary
   that LK leaves the WDT armed. If the screen is frozen for more than 2 minutes with no new USB device, assume it did not.
4. **Hands needed:** hold **Power for ~10–15 s** until the screen goes off and the tablet restarts
   (MT6328 long-press reset). It then boots Android from `boot`, because the recovery request is one-shot
   (also unverified; if it boots the test image again, hold Vol-Down/Vol-Up + Power for the LK boot menu or
   fastboot, and run 3c).

After any reboot back into Android, check whether the mainline kernel log survived in RAM (ramoops at
0x43f10000, the same region the stock kernel uses for pstore):
```sh
adb shell su -c 'ls -l /sys/fs/pstore; cat /sys/fs/pstore/console-ramoops* 2>/dev/null | tail -100' > logs/pstore-after.txt
```
(Unverified: depends on the stock kernel's pstore config. An empty result proves nothing.)

## 5. What not to do
- Do not `fastboot flash boot` any of these images. Magisk and Android live there.
- Do not run `fastboot erase` or `fastboot flash` on anything other than `recovery`.
