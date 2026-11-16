#!/bin/sh
# Run a command on the tablet's mainline Alpine over the USB network (key auth, no host-key bookkeeping).
#   mainline/scripts/tb.sh 'uname -a'      stdin is passed through: tb.sh 'cat > /tmp/x' < file
exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes \
	-o ConnectTimeout=5 "${TAB:-root@172.16.42.1}" "$@"
