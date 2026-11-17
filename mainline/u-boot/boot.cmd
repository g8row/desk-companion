# TB-7304X boot script (hush). build-uboot.sh makes it the U-Boot image's ramdisk; LK loads it to 0x44000000 and
# CONFIG_BOOTCOMMAND sources it. Edit and rebuild the image; no U-Boot recompile needed.
#
# Target: /cache/linux/boot-target on Android's cache (ext4), one line "target=<x>", written by either OS:
#   android (default, also when the file is missing)  linux  fastboot
# Android is read from ${android_part}, set by tb_lk_info() from LK's boot mode: `boot` while U-Boot sits in
# `recovery`, `recovery` once U-Boot is in `boot`. U-Boot never writes the eMMC.

setenv target android
mmc dev 0
if load mmc 0#cache 0x4b000000 linux/boot-target; then env import -t 0x4b000000 ${filesize}; fi
echo tb7304x: target ${target}, Android in ${android_part}

if test "${target}" = "fastboot"; then
	echo tb7304x: fastboot usb 0 (fastboot boot <img> / fastboot continue = Android / fastboot reboot)
	fastboot usb 0
fi

if test "${target}" = "linux"; then
	if load mmc 0#cache 0x50000000 linux/boot-mainline-uboot.img; then
		bootm 0x50000000
	fi
	echo tb7304x: no bootable /cache/linux/boot-mainline-uboot.img, booting Android
fi

if part start mmc 0 ${android_part} abs && part size mmc 0 ${android_part} abn; then
	mmc read 0x50000000 ${abs} ${abn}
	tbandroid 0x50000000
fi

echo tb7304x: Android boot failed. fastboot usb 0 (fastboot boot <img> / fastboot reboot)
fastboot usb 0
sleep 10
reset
