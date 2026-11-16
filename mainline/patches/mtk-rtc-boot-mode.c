// SPDX-License-Identifier: GPL-2.0-only
/*
 * Tell MediaTek LK where to boot next, like the stock kernel's `reboot bootloader` / `reboot recovery`.
 *
 * LK reads the PMIC RTC spare register RTC_PDN1 at boot (MT6328: RTC at PMIC offset 0x4000, reached through the
 * PMIC wrapper's regmap):
 *   bit 13       Fast Boot  -> LK fastboot ("Set_RTC_Fastboot_Mode" in lk.bin)
 *   bits 4-5 = 1 recovery   -> the recovery partition (MTK calls it "factory reset" but only LK acts on it here)
 * RTC registers only latch after RTC_WRTGR is written and RTC_BBPU.CBUSY clears.
 *
 * The bits are written as soon as userspace asks, so any reboot afterwards (including sysrq 'b', which skips
 * the reboot notifiers) uses them:
 *   echo bootloader > /sys/devices/platform/rtc-boot-mode/next_boot     (or recovery / normal)
 * `reboot <arg>` through the syscall works too (reboot notifier).
 */
#define pr_fmt(fmt) "rtc-boot-mode: " fmt

#include <linux/delay.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/of_platform.h>
#include <linux/platform_device.h>
#include <linux/reboot.h>
#include <linux/regmap.h>

#define RTC_BASE		0x4000
#define RTC_BBPU		(RTC_BASE + 0x00)
#define  RTC_BBPU_CBUSY		BIT(6)
#define RTC_PDN1		(RTC_BASE + 0x2c)
#define  PDN1_RECOVERY_MASK	(3 << 4)
#define  PDN1_RECOVERY		(1 << 4)
#define  PDN1_FAST_BOOT		BIT(13)
#define RTC_WRTGR		(RTC_BASE + 0x3c)

struct rtc_boot_mode {
	struct regmap *map;
	struct notifier_block nb;
};

static int write_trigger(struct regmap *map)
{
	unsigned int v;
	int i, ret;

	ret = regmap_write(map, RTC_WRTGR, 1);
	if (ret)
		return ret;
	for (i = 0; i < 1000; i++) {
		ret = regmap_read(map, RTC_BBPU, &v);
		if (ret)
			return ret;
		if (!(v & RTC_BBPU_CBUSY))
			return 0;
		udelay(10);
	}
	return -ETIMEDOUT;
}

static int set_mode(struct rtc_boot_mode *bm, const char *mode)
{
	unsigned int pdn1;
	int ret;

	ret = regmap_read(bm->map, RTC_PDN1, &pdn1);
	if (ret)
		return ret;
	pdn1 &= ~(PDN1_FAST_BOOT | PDN1_RECOVERY_MASK);
	if (sysfs_streq(mode, "bootloader") || sysfs_streq(mode, "fastboot"))
		pdn1 |= PDN1_FAST_BOOT;
	else if (sysfs_streq(mode, "recovery"))
		pdn1 |= PDN1_RECOVERY;
	else if (!sysfs_streq(mode, "normal") && !sysfs_streq(mode, "android") && *mode)
		return -EINVAL;
	ret = regmap_write(bm->map, RTC_PDN1, pdn1);
	if (!ret)
		ret = write_trigger(bm->map);
	pr_info("next boot: %s (PDN1=%#06x)%s\n", *mode ? mode : "normal", pdn1, ret ? " FAILED" : "");
	return ret;
}

static ssize_t next_boot_show(struct device *dev, struct device_attribute *attr, char *buf)
{
	struct rtc_boot_mode *bm = dev_get_drvdata(dev);
	unsigned int pdn1;
	int ret = regmap_read(bm->map, RTC_PDN1, &pdn1);

	if (ret)
		return ret;
	return sysfs_emit(buf, "%s\n", pdn1 & PDN1_FAST_BOOT ? "bootloader" :
			  (pdn1 & PDN1_RECOVERY_MASK) == PDN1_RECOVERY ? "recovery" : "normal");
}

static ssize_t next_boot_store(struct device *dev, struct device_attribute *attr,
			       const char *buf, size_t count)
{
	int ret = set_mode(dev_get_drvdata(dev), buf);

	return ret ? ret : count;
}
static DEVICE_ATTR_RW(next_boot);

static int reboot_cb(struct notifier_block *nb, unsigned long action, void *cmd)
{
	struct rtc_boot_mode *bm = container_of(nb, struct rtc_boot_mode, nb);

	if (action == SYS_RESTART && cmd)
		set_mode(bm, cmd);
	return NOTIFY_DONE;
}

static int rtc_boot_mode_probe(struct platform_device *pdev)
{
	struct device *dev = &pdev->dev;
	struct device_node *np;
	struct platform_device *pwrap;
	struct rtc_boot_mode *bm;
	int ret;

	np = of_parse_phandle(dev->of_node, "mediatek,pwrap", 0);
	if (!np)
		return dev_err_probe(dev, -EINVAL, "no mediatek,pwrap phandle\n");
	pwrap = of_find_device_by_node(np);
	of_node_put(np);
	if (!pwrap)
		return -EPROBE_DEFER;

	bm = devm_kzalloc(dev, sizeof(*bm), GFP_KERNEL);
	if (!bm)
		return -ENOMEM;
	bm->map = dev_get_regmap(&pwrap->dev, NULL);
	put_device(&pwrap->dev);
	if (!bm->map)
		return -EPROBE_DEFER;
	platform_set_drvdata(pdev, bm);

	ret = device_create_file(dev, &dev_attr_next_boot);
	if (ret)
		return ret;
	bm->nb.notifier_call = reboot_cb;
	bm->nb.priority = 192;
	return devm_register_reboot_notifier(dev, &bm->nb);
}

static const struct of_device_id rtc_boot_mode_of_match[] = {
	{ .compatible = "lenovo,tb7304x-rtc-boot-mode" },
	{ }
};

static struct platform_driver rtc_boot_mode_driver = {
	.probe = rtc_boot_mode_probe,
	.driver = {
		.name = "mtk-rtc-boot-mode",
		.of_match_table = rtc_boot_mode_of_match,
	},
};
builtin_platform_driver(rtc_boot_mode_driver);
