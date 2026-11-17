// SPDX-License-Identifier: GPL-2.0
/*
 * MediaTek MT6328 PMIC AUXADC (TB-7304X). Register sequence and channel scaling from the MT6735 BSP
 * (drivers/misc/mediatek/power/mt6735/pmic_auxadc.c, PMIC_IMM_GetOneChannelValue):
 *   enable AUXADC_CK_AON, RG_VBUF_EN, RG_CLKSQ_EN_AUX_AP_MODE; write BIT(ch) to AUXADC_RQST0_SET;
 *   poll bit 15 (ready) of the channel's output register; the value is in the low 15 or 12 bits.
 * Full scale 1800 mV. CH0 (BATSNS) has a /3 divider inside the PMIC; CH0/CH7 are 15-bit, the others 12-bit.
 * Channels (BSP names): 0 BATSNS (battery), 1 ISENSE, 2 VCDT (charger input, external divider on the board),
 * 3 BATON (battery NTC), 4 PMIC temperature, 5 ACCDET, 7 TSX. Only the AP request path is used; the modem side
 * (RQST1) is not touched.
 */
#include <linux/delay.h>
#include <linux/iio/iio.h>
#include <linux/mfd/mt6397/core.h>
#include <linux/module.h>
#include <linux/mod_devicetable.h>
#include <linux/mutex.h>
#include <linux/platform_device.h>
#include <linux/regmap.h>

#define MT6328_TOP_CLKSQ		0x028a
#define MT6328_CLKSQ_EN_AUX_AP		BIT(8)
#define MT6328_AUXADC_RQST0_SET		0x0e8a
#define MT6328_AUXADC_CON0		0x0e94
#define MT6328_AUXADC_CK_AON		BIT(15)
#define MT6328_AUXADC_CON12		0x0eb0
#define MT6328_AUXADC_VBUF_EN		BIT(7)
#define MT6328_AUXADC_RDY		BIT(15)
#define MT6328_AUXADC_FULL_MV		1800

struct mt6328_auxadc {
	struct regmap *regmap;
	struct mutex lock;
};

struct mt6328_auxadc_ch {
	u16 out_reg;	/* AP result register: ready bit 15, value below */
	u8 bits;	/* 15 or 12 */
	u8 div;		/* internal divider */
};

static const struct mt6328_auxadc_ch mt6328_ch[] = {
	[0] = { 0x0e2e, 15, 3 },	/* BATSNS  (AUXADC_ADC23, by AP) */
	[1] = { 0x0e32, 15, 3 },	/* ISENSE  (AUXADC_ADC25, by AP) */
	[2] = { 0x0e04, 12, 1 },	/* VCDT    (AUXADC_ADC2) */
	[3] = { 0x0e06, 12, 1 },	/* BATON   (AUXADC_ADC3) */
	[4] = { 0x0e08, 12, 1 },	/* CH4: PMIC temperature (AUXADC_ADC4) */
	[5] = { 0x0e0a, 12, 1 },	/* ACCDET  (AUXADC_ADC5) */
	[7] = { 0x0e24, 15, 1 },	/* TSX     (AUXADC_ADC18, by AP) */
};

#define MT6328_CHAN(_ch, _name) {					\
	.type = IIO_VOLTAGE,						\
	.indexed = 1,							\
	.channel = (_ch),						\
	.datasheet_name = (_name),					\
	.info_mask_separate = BIT(IIO_CHAN_INFO_RAW) | BIT(IIO_CHAN_INFO_SCALE), \
}

static const struct iio_chan_spec mt6328_auxadc_channels[] = {
	MT6328_CHAN(0, "batsns"),
	MT6328_CHAN(1, "isense"),
	MT6328_CHAN(2, "vcdt"),
	MT6328_CHAN(3, "baton"),
	MT6328_CHAN(4, "pmic_temp"),
	MT6328_CHAN(5, "accdet"),
	MT6328_CHAN(7, "tsx"),
};

static int mt6328_auxadc_enable(struct mt6328_auxadc *adc)
{
	int ret;

	ret = regmap_set_bits(adc->regmap, MT6328_AUXADC_CON0, MT6328_AUXADC_CK_AON);
	if (!ret)
		ret = regmap_set_bits(adc->regmap, MT6328_AUXADC_CON12, MT6328_AUXADC_VBUF_EN);
	if (!ret)
		ret = regmap_set_bits(adc->regmap, MT6328_TOP_CLKSQ, MT6328_CLKSQ_EN_AUX_AP);
	return ret;
}

static int mt6328_auxadc_read(struct mt6328_auxadc *adc, int ch, int *val)
{
	const struct mt6328_auxadc_ch *c = &mt6328_ch[ch];
	unsigned int v;
	int ret;

	mutex_lock(&adc->lock);
	ret = mt6328_auxadc_enable(adc);
	if (!ret)
		ret = regmap_write(adc->regmap, MT6328_AUXADC_RQST0_SET, BIT(ch));
	if (!ret) {
		udelay(50);
		/* the BSP polls 1-2 ms at a time, up to 15 times */
		ret = regmap_read_poll_timeout(adc->regmap, c->out_reg, v, v & MT6328_AUXADC_RDY, 1000, 30000);
	}
	mutex_unlock(&adc->lock);
	if (ret)
		return ret;
	*val = v & GENMASK(c->bits - 1, 0);
	return 0;
}

static int mt6328_auxadc_read_raw(struct iio_dev *indio_dev, struct iio_chan_spec const *chan,
				  int *val, int *val2, long mask)
{
	struct mt6328_auxadc *adc = iio_priv(indio_dev);
	const struct mt6328_auxadc_ch *c = &mt6328_ch[chan->channel];
	int ret;

	switch (mask) {
	case IIO_CHAN_INFO_RAW:
		ret = mt6328_auxadc_read(adc, chan->channel, val);
		return ret ? ret : IIO_VAL_INT;
	case IIO_CHAN_INFO_SCALE:
		/* mV per LSB = div * 1800 / 2^bits */
		*val = c->div * MT6328_AUXADC_FULL_MV;
		*val2 = c->bits;
		return IIO_VAL_FRACTIONAL_LOG2;
	default:
		return -EINVAL;
	}
}

static const struct iio_info mt6328_auxadc_info = {
	.read_raw = mt6328_auxadc_read_raw,
};

static int mt6328_auxadc_probe(struct platform_device *pdev)
{
	struct mt6397_chip *chip = dev_get_drvdata(pdev->dev.parent);
	struct iio_dev *indio_dev;
	struct mt6328_auxadc *adc;
	int ret;

	if (!chip || !chip->regmap)
		return dev_err_probe(&pdev->dev, -ENODEV, "no PMIC regmap\n");

	indio_dev = devm_iio_device_alloc(&pdev->dev, sizeof(*adc));
	if (!indio_dev)
		return -ENOMEM;
	adc = iio_priv(indio_dev);
	adc->regmap = chip->regmap;
	ret = devm_mutex_init(&pdev->dev, &adc->lock);
	if (ret)
		return ret;

	indio_dev->name = "mt6328-auxadc";
	indio_dev->info = &mt6328_auxadc_info;
	indio_dev->modes = INDIO_DIRECT_MODE;
	indio_dev->channels = mt6328_auxadc_channels;
	indio_dev->num_channels = ARRAY_SIZE(mt6328_auxadc_channels);

	return devm_iio_device_register(&pdev->dev, indio_dev);
}

static const struct of_device_id mt6328_auxadc_of_match[] = {
	{ .compatible = "mediatek,mt6328-auxadc" },
	{ }
};
MODULE_DEVICE_TABLE(of, mt6328_auxadc_of_match);

static struct platform_driver mt6328_auxadc_driver = {
	.driver = {
		.name = "mt6328-auxadc",
		.of_match_table = mt6328_auxadc_of_match,
	},
	.probe = mt6328_auxadc_probe,
};
module_platform_driver(mt6328_auxadc_driver);

MODULE_DESCRIPTION("MediaTek MT6328 PMIC AUXADC");
MODULE_LICENSE("GPL");
