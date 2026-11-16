FROM debian:trixie
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential bc bison flex libssl-dev libelf-dev device-tree-compiler git python3 \
    mkbootimg busybox-static cpio xz-utils lz4 gzip kmod ca-certificates file u-boot-tools \
    android-sdk-libsparse-utils rsync && rm -rf /var/lib/apt/lists/*
# x86_64 hosts: cross toolchain + an arm64 busybox for the initramfs (unpacked, not installed)
RUN if [ "$(dpkg --print-architecture)" != arm64 ]; then \
      dpkg --add-architecture arm64 && apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross && \
      cd /tmp && apt-get download busybox-static:arm64 && dpkg-deb -x busybox-static_*_arm64.deb /opt/arm64 && \
      rm -rf /tmp/*.deb /var/lib/apt/lists/*; fi
ENV BUSYBOX_ARM64=/opt/arm64/usr/bin/busybox
