#!/bin/sh
set -e

/usr/bin/Xvfb -ac :99 -screen 0 1280x1024x24 &
XVFB_PID=$!

trap 'kill -TERM $XVFB_PID 2>/dev/null; wait $XVFB_PID 2>/dev/null; exit 0' TERM INT

exec node /service/server.js
