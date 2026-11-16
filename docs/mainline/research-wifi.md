# TB-7304X mainline: WiFi / BT (MT6625L via CONSYS) — feasibility notes

Status 2026-11-16: research only, nothing built yet.

## Hardware
- The WiFi/BT/GPS/FM MAC and baseband live in the SoC's **CONSYS** (connectivity subsystem); the **MT6625L** next to
  it is the RF/analog companion. Android talks to CONSYS through **WMT** (wireless management task) over **BTIF**
  with the **STP** protocol, and loads firmware patches (ROM patch + RAM code) into EMI-reserved memory.
- mt6735 mainline power bindings already have `MT6735_POWER_DOMAIN_CONN`; there is no CONSYS node, driver or
  reserved-memory layout in mainline.

## Stock DT (mainline/stock/stock.dts)
| Node | Values |
|---|---|
| `consys@18070000` | `mediatek,mt6735m-consys`, `mediatek,mt6735-consys`; reg 0x18070000/0x200 (CONSYS), 0x10212000/0x100, 0x10000000/0x2000 (topckgen), 0x10006000/0x1000 (SPM); IRQs SPI 227 (0xe3) and 225 (0xe1); supplies vcn18, vcn28, vcn33_bt, vcn33_wifi (MT6328 LDOs); pinctrl states for the GPS LNA |
| `btif@1100c000` | `mediatek,btif`, IRQ SPI 90 (0x5a) |
| `wifi@180f0000` | `mediatek,wifi`, reg 0x180f0000/0x5c, IRQ SPI 226 (0xe2) |
| `consys-reserve-memory` | `mediatek,consys-reserve-memory`, no-map, 1 MB, 2 MB aligned (dynamic: LK/kernel picks the address) |

## Prior art
- No mainline driver for any MT65xx/MT67xx CONSYS WiFi. postmarketOS' MT6735 kernel has no WiFi either.
- **Banana Pi R2 (MT7623 + MT6625L, same CONSYS + combo-RF design):** frank-w's BPI-Router-Linux kernel carried
  MediaTek's WMT/BTIF/STP + `wlan_gen2` driver, ported forward from the vendor BSP, in
  `drivers/misc/mediatek/{btif,connectivity}` on the **5.4-main, 5.10-main and 5.15-main** branches; dropped from
  6.1-main on (checked via the GitHub API). Userspace: `wmt_loader`, `stp_uart_launcher -p /etc/firmware`, then
  `wlan_gen2`. Reported working on 5.8–5.10 (2.4 GHz). Known issue: hangs if another `wlan0` exists.
  Upstream consensus: too large for mainline, depends on the WMT tools.
- Downstream MT6735 BSP (`dhirajms/kernel_lenovo_P1m_3.18.y`, `maozi-114/android_kernel_mt6735-37_3.18.79`) has
  the MT6735-specific CONSYS platform layer (`connectivity/common/combo/linux/pub/.../mt6735`?) — to be located.

## Plan sketch (out-of-tree, not upstreamable)
1. Take frank-w's 5.15-main `drivers/misc/mediatek/{btif,connectivity}` and forward-port to 7.0 (cfg80211,
   timer, procfs, kthread, DMA API drift since 5.15).
2. Replace the MT7623 CONSYS platform code with MT6735's from the downstream 3.18 BSP: CONN power domain
   (mainline genpd), clocks, CONSYS reset, EMI reserved memory (add a `reserved-memory` node at the address the
   stock DT/LK uses), BTIF base/IRQ, CONSYS IRQs.
3. Firmware from the tablet's Android `/system/etc/firmware` (WMT_SOC.cfg, ROM patch, WIFI RAM code) into the rootfs.
4. Userspace: wmt_loader / stp launcher equivalents (from frank-w's tree or the BSP), then `wlan_gen2` →
   `wlan0`, wpa_supplicant.

Effort: weeks; risk: high (CONSYS power-on and EMI layout are the unknowns). Value for the desk use case is moderate
— USB already provides power + network to the host. Order: read the stock DT's consys/btif/reserved-memory nodes and
the BSP platform layer first, then decide.

## Sources
- OpenWrt forum, UFI6735 (MT6735 has no usable mainline support): https://forum.openwrt.org/t/ufi6735-mediatek-mt6735-4g-lte-wifi-usb-stick-router/141528
- TeamYogaBlade2 MT6628 issue (gen2 vendor paths): https://github.com/TeamYogaBlade2/linux/issues/35
- Banana Pi forum, BPI-R2 internal WiFi/BT (MT6625L): https://forum.banana-pi.org/t/bpi-r2-internal-wifi-bt-mt6625l-kernel/4307/337
- frank-w wiki, BPI-R2 WLAN setup: https://fw-web.de/dokuwiki/doku.php?id=en:bpi-r2:wlan
- frank-w kernel: https://github.com/frank-w/BPI-Router-Linux (branches 5.4-main … 5.15-main)
- postmarketOS MT6735 wiki: https://wiki.postmarketos.org/wiki/MediaTek_MT6737M
