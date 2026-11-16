#!/bin/bash
# Runs inside the tb7304-build container (debian trixie arm64, native gcc).
#   /m      = lenovo-tab/mainline (bind mount)
#   /kout   = kernel build dir (docker volume tb7304-kbuild)
#   /stock  = lenovo-tab/backup/partitions (read-only)
set -euo pipefail
M=/m; K=$M/src/linux; O=/kout; OUT=$M/out; mkdir -p $OUT /build
JOBS=$(nproc)
CMDLINE_BASE="bootopt=64S3,32N2,64N2"
MKB="mkbootimg --base 0x40000000 --kernel_offset 0x00080000 --ramdisk_offset 0x04000000 \
 --second_offset 0x00f00000 --tags_offset 0x0e000000 --pagesize 2048 --header_version 0 \
 --os_version 7.0.0 --os_patch_level 2018-07 --board 1535456354"


# Debian's mkbootimg writes second_addr=0 when there is no second stage; stock has 0x40f00000. Match stock.
fixhdr() { python3 -c "
import sys,struct
f=open(sys.argv[1],'r+b'); f.seek(28); f.write(struct.pack('<I',0x40f00000)); f.close()" "$1"; }

echo "== 0. sanity: rebuild stock boot.img from its parts with our mkbootimg parameters"
python3 - <<'PY'
import struct
b=open('/stock/boot.bin','rb').read(); ps=2048
ks,rs=struct.unpack_from('<I',b,8)[0],struct.unpack_from('<I',b,16)[0]
pg=lambda n:(n+ps-1)//ps*ps
open('/build/stock-kernel','wb').write(b[ps:ps+ks])
open('/build/stock-ramdisk','wb').write(b[ps+pg(ks):ps+pg(ks)+rs])
PY
$MKB --kernel /build/stock-kernel --ramdisk /build/stock-ramdisk --cmdline "$CMDLINE_BASE" -o /build/stock-repack.img
fixhdr /build/stock-repack.img
n=$(stat -c%s /build/stock-repack.img)
if cmp -s /build/stock-repack.img <(head -c $n /stock/boot.bin); then echo "   stock repack: IDENTICAL to boot.bin (first $n bytes)"; else
  echo "   stock repack differs:"; cmp /build/stock-repack.img <(head -c $n /stock/boot.bin) | head -3 || true; fi

echo "== 1. initramfs"
R=/build/rootfs; rm -rf $R; mkdir -p $R/bin $R/www $R/dev
cp /bin/busybox $R/bin/busybox
gcc -static -O2 -Wall -o $R/bin/lkpaint $M/initramfs/lkpaint.c
strip $R/bin/lkpaint
cp $M/initramfs/init $R/init; chmod 755 $R/init
mknod -m 600 $R/dev/console c 5 1; mknod -m 666 $R/dev/null c 1 3
(cd $R && find . | sort | cpio -o -H newc --owner=0:0 2>/dev/null) > /build/initramfs.cpio
gzip -9 -n -c /build/initramfs.cpio > $OUT/initramfs.cpio.gz
ls -la $OUT/initramfs.cpio.gz

echo "== 2. kernel"
sh $M/patches/0001-soc-mediatek-mtk-lk-fb.sh $K
cp $M/src/pmaports/device/*/linux-postmarketos-mediatek-mt6735/config-postmarketos-mediatek-mt6735.aarch64 $O/.config
cat $M/patches/config-tb7304x.fragment >> $O/.config
make -C $K O=$O ARCH=arm64 olddefconfig >/dev/null
for opt in MODULES DRM_MEDIATEK MTK_LK_FB DRM_SIMPLEDRM FB_DEVICE STRICT_DEVMEM INITRAMFS_SOURCE USB_MUSB_GADGET USB_CONFIGFS_ECM PSTORE_RAM; do
  grep -E "^(# )?CONFIG_${opt}[= ]" $O/.config || echo "   CONFIG_$opt missing"; done
make -C $K O=$O ARCH=arm64 -j$JOBS KBUILD_BUILD_USER=tb7304 KBUILD_BUILD_HOST=mainline Image.gz mediatek/mt6737m-lenovo-tb7304x.dtb 2>&1 | grep -E "error|warning: |Kernel: |DTC" | grep -v "^  DTC" | tail -40 || true
cp $O/.config $OUT/kernel.config
cp $O/arch/arm64/boot/dts/mediatek/mt6737m-lenovo-tb7304x.dtb $OUT/
python3 - <<PY
import struct,gzip
img=gzip.open('$O/arch/arm64/boot/Image.gz').read()
tofs,isz=struct.unpack_from('<QQ',img,8)
print('   Image %d bytes, header text_offset=0x%x image_size=0x%x -> ends at 0x%x (ATF reserved starts 0x43000000)'%(len(img),tofs,isz,0x40080000+isz))
assert 0x40080000+isz < 0x43000000, 'kernel would overlap ATF reserved memory'
assert len(img) <= 0x1c00000, 'LK gunzip limit is 0x1c00000 (28 MiB) of decompressed Image (lk.bin @0x41e1f5c8)'
print('   LK gunzip limit 0x1c00000: %d bytes headroom'%(0x1c00000-len(img)))
PY

echo "== 3. boot images"
cat $O/arch/arm64/boot/Image.gz $OUT/mt6737m-lenovo-tb7304x.dtb > /build/Image.gz-dtb
CL="$CMDLINE_BASE console=tty0 clk_ignore_unused pd_ignore_unused regulator_ignore_unused maxcpus=1 ignore_loglevel panic=10 oops=panic tb.autoreboot=300"
$MKB --kernel /build/Image.gz-dtb --ramdisk $OUT/initramfs.cpio.gz --cmdline "$CL" -o $OUT/boot-mainline.img
# lkfb.ovl=0: same, but the shim does not touch display registers (only atag,videolfb)
$MKB --kernel /build/Image.gz-dtb --ramdisk $OUT/initramfs.cpio.gz --cmdline "$CL lkfb.ovl=0" -o $OUT/boot-mainline-noovl.img
# control: untouched stock 3.18 kernel+DTB, our initramfs
$MKB --kernel /build/stock-kernel --ramdisk $OUT/initramfs.cpio.gz --cmdline "$CMDLINE_BASE panic=10 tb.autoreboot=300" -o $OUT/boot-stock-kernel-initramfs.img
for i in $OUT/boot-*.img; do fixhdr $i; done
cd $OUT && sha256sum boot-*.img initramfs.cpio.gz mt6737m-lenovo-tb7304x.dtb > SHA256SUMS && ls -la boot-*.img && cat SHA256SUMS
