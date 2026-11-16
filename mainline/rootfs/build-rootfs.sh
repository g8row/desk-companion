#!/bin/sh
# Build the TB-7304X stage-2 root filesystem: Alpine aarch64 as an ext4 image (docs/mainline/research-rootfs.md).
# Runs on any x86_64 or arm64 Docker host, no qemu: apk installs the aarch64 packages with --no-scripts and this
# script does what their install scripts would have done.
#
#   sh mainline/rootfs/build-rootfs.sh <ssh-public-key> [out-dir]     -> out-dir/rootfs.img (+ .sha256)
#
# The image goes into Android's cache filesystem as /cache/linux/rootfs.img (see TEST-PLAN.md).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
KEY=${1:?usage: build-rootfs.sh <ssh-public-key> [out-dir]}
OUT=$(mkdir -p "${2:-$HERE/out}" && cd "${2:-$HERE/out}" && pwd)
ALPINE=3.24 V=3.24.4 SIZE=${SIZE:-256M}
PKGS="alpine-base busybox-extras dropbear dropbear-scp e2fsprogs nano htop evtest i2c-tools"
cp "$KEY" "$OUT/authorized_keys"

docker run --rm -v "$HERE/overlay:/overlay:ro" -v "$OUT:/out" alpine:$ALPINE sh -euc "
  apk add --no-cache e2fsprogs >/dev/null
  cd /tmp; R=/tmp/r; mkdir -p \$R
  F=alpine-minirootfs-$V-aarch64.tar.gz; U=https://dl-cdn.alpinelinux.org/alpine/v$ALPINE/releases/aarch64
  wget -q \$U/\$F \$U/\$F.sha256
  sha256sum -c \$F.sha256
  tar xzf \$F -C \$R
  cp -a /overlay/. \$R/ && chown -R 0:0 \$R/etc
  apk --root \$R --arch aarch64 --no-scripts --no-cache add $PKGS
  # what the skipped install scripts and setup-alpine would do
  for a in telnetd telnet ftpd ftpget ftpput httpd inetd tftp tftpd udhcpd dnsd fakeidentd; do ln -sf /bin/busybox-extras \$R/usr/sbin/\$a; done
  for s in devfs dmesg mdev; do ln -sf /etc/init.d/\$s \$R/etc/runlevels/sysinit/; done
  for s in hostname bootmisc sysctl syslog networking urandom; do ln -sf /etc/init.d/\$s \$R/etc/runlevels/boot/; done
  for s in dropbear local; do ln -sf /etc/init.d/\$s \$R/etc/runlevels/default/; done
  for s in killprocs savecache; do ln -sf /etc/init.d/\$s \$R/etc/runlevels/shutdown/; done
  mkdir -p \$R/root/.ssh \$R/mnt/cache; chmod 700 \$R/root/.ssh
  install -m 600 /out/authorized_keys \$R/root/.ssh/authorized_keys
  sed -i 's|^root:[^:]*:|root:*:|' \$R/etc/shadow          # no password logins; ssh key or USB telnet only
  echo 'DROPBEAR_OPTS=\"-s -p 172.16.42.1:22\"' > \$R/etc/conf.d/dropbear
  echo 'TB-7304X mainline (Alpine $V). Safety net: /etc/local.d/tb-autoreboot.start' > \$R/etc/motd
  rm -f /out/rootfs.img
  truncate -s $SIZE /out/rootfs.img
  mkfs.ext4 -q -L tbroot -d \$R /out/rootfs.img
  cd /out && sha256sum rootfs.img > rootfs.img.sha256 && cat rootfs.img.sha256
  du -sh \$R
"
rm -f "$OUT/authorized_keys"
ls -la "$OUT"
