# TB-7304X boot script (hush). build-uboot.sh makes it the U-Boot image's ramdisk; LK loads it to 0x44000000 and
# CONFIG_BOOTCOMMAND sources it. Edit and rebuild the image; no U-Boot recompile needed.
#
# The target comes from the boot record (`tbstate`, two copies at the end of `boot`; mainline/u-boot/tbstate.h,
# docs/mainline/plan-dualboot.md §4), written by Linux/Android with the `tbstate` tool:
#   oneshot (consumed here) > default (linux unless set to android)
# Always Android: LK bootmode 7/8/9 (RTC alarm, charger plugged in while off), a record that cannot be read or is
# corrupt, and Linux after `max` boots in a row that never reached "healthy" (stage 2 resets the count after 60 s).
# Android is read from ${android_part} (set by tb_lk_info from LK's boot mode: `recovery` while U-Boot is in
# `boot`). The only eMMC writes are `tbstate save` (the two record sectors).

setenv target linux
mmc dev 0
if tbstate load; then
	setenv target ${tb_default}
	if test "${tb_state}" = blank; then
		echo tb7304x: no boot record yet, creating one (default linux)
		tbstate save
	fi
	if test "${tb_state}" = corrupt; then
		echo tb7304x: boot record corrupt, rewriting it and booting Android
		tbstate fail corrupt
		tbstate save
		setenv target android
	fi
	if test "${tb_oneshot}" != none; then
		setenv target ${tb_oneshot}
		tbstate set oneshot none
		tbstate save
	fi
else
	echo tb7304x: boot record unreadable, booting Android
	setenv target android
fi
# Charger plugged in while off (LK KPOC, bootmode 8/9) and RTC alarm (7) always go to Android: its charging UI and
# alarm handling exist, Linux has neither. lk_bootmode is decimal (env_set_ulong).
if test "${lk_bootmode}" = 7 || test "${lk_bootmode}" = 8 || test "${lk_bootmode}" = 9; then setenv target android; fi
tbstate show
echo tb7304x: target ${target} (LK bootmode ${lk_bootmode}), Android in ${android_part}

if test "${target}" = "fastboot"; then
	echo tb7304x: fastboot usb 0 (fastboot boot <img> / fastboot reboot; NOT continue: it resets)
	fastboot usb 0
fi

if test "${target}" = "linux"; then
	if test ${tb_attempts} -ge ${tb_max}; then
		echo tb7304x: Linux started ${tb_attempts} times without reaching healthy, booting Android
		tbstate fail attempts
		tbstate save
	else
		tbstate attempt
		tbstate save
		if load mmc 0#cache 0x50000000 linux/boot-mainline-uboot.img; then
			bootm 0x50000000
			tbstate fail bootm
		else
			tbstate fail no-image
		fi
		tbstate save
		echo tb7304x: no bootable /cache/linux/boot-mainline-uboot.img, booting Android
	fi
fi

if part start mmc 0 ${android_part} abs && part size mmc 0 ${android_part} abn; then
	mmc read 0x50000000 ${abs} ${abn}
	tbandroid 0x50000000
fi

echo tb7304x: Android boot failed. fastboot usb 0 (fastboot boot <img> / fastboot reboot)
fastboot usb 0
sleep 10
reset
