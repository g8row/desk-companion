/* SPDX-License-Identifier: GPL-2.0 */
/*
 * TB-7304X boot record ("tbstate"), shared by U-Boot (tb7304x_tbstate.c) and Linux/Android
 * (mainline/initramfs/tbstate.c). Design: docs/mainline/plan-dualboot.md §4.
 *
 * Two 512-byte copies, each with magic, version, generation and a CRC32 (zlib polynomial, over the whole block
 * with the crc field zero). Readers take the valid copy with the higher generation. Writers write generation+1
 * into the slot (generation & 1), i.e. always over the OLDER copy, so a power loss leaves the other one intact.
 *
 * Location (interim, until the `tbstate` partition exists after repartitioning): the last 1 MiB of the `boot`
 * partition, which holds U-Boot (< 1 MiB). LK only reads the header and kernel area of `boot`.
 */
#ifndef TBSTATE_H
#define TBSTATE_H

#define TBS_PART		"boot"		/* GPT partition name */
#define TBS_AREA_SECTOR		30720		/* 15 MiB into the partition (512-byte sectors) */
#define TBS_COPY_STRIDE		128		/* second copy 64 KiB later */
#define TBS_PART_MIN_SECTORS	32768		/* refuse to write unless the partition is >= 16 MiB */
#define TBS_IMAGE_LIMIT		(TBS_AREA_SECTOR * 512)	/* a U-Boot image must end before the area */

#define TBS_MAGIC		0x31534254	/* "TBS1" */
#define TBS_VERSION		1

enum tbs_target { TBS_T_NONE = 0, TBS_T_LINUX = 1, TBS_T_ANDROID = 2, TBS_T_FASTBOOT = 3 };
enum tbs_stage { TBS_S_NONE = 0, TBS_S_UBOOT = 1, TBS_S_KERNEL = 2, TBS_S_INIT = 3, TBS_S_HEALTHY = 4 };
enum tbs_error { TBS_E_NONE = 0, TBS_E_ATTEMPTS = 1, TBS_E_CORRUPT = 2, TBS_E_NO_IMAGE = 3, TBS_E_BOOTM = 4 };

struct tbstate {
	unsigned int magic;
	unsigned int version;
	unsigned int generation;
	unsigned int crc;
	unsigned char default_target;	/* tbs_target: LINUX or ANDROID */
	unsigned char oneshot;		/* tbs_target, consumed (set to NONE) by U-Boot when it acts on it */
	unsigned char attempts;		/* Linux boots started by U-Boot since the last healthy one */
	unsigned char max_attempts;	/* at attempts >= max_attempts U-Boot boots Android instead */
	unsigned char last_stage;	/* tbs_stage reached by the last Linux boot */
	unsigned char last_error;	/* tbs_error, why U-Boot last fell back */
	unsigned char slot;		/* reserved for A/B: 0 = /cache/linux image */
	unsigned char last_good_slot;
	unsigned int linux_boots;	/* diagnostic counters */
	unsigned int fallbacks;
	unsigned char reserved[512 - 32];
};

static const char *const tbs_target_name[] = { "none", "linux", "android", "fastboot" };
static const char *const tbs_stage_name[] = { "none", "uboot", "kernel", "init", "healthy" };
static const char *const tbs_error_name[] = { "none", "attempts", "corrupt", "no-image", "bootm" };

#endif
