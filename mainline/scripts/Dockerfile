FROM debian:trixie
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential bc bison flex libssl-dev libelf-dev device-tree-compiler git python3 \
    mkbootimg busybox-static cpio xz-utils lz4 gzip kmod ca-certificates file u-boot-tools \
    android-sdk-libsparse-utils rsync && rm -rf /var/lib/apt/lists/*
