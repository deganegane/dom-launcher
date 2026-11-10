#!/bin/sh
# Uklanja Dom launcher i autostart. LG Home ostaje netaknut.
APPID="com.deganegane.dom"
rm -f /var/lib/webosbrew/init.d/90-dom-launcher
[ -f /tmp/dom-homeguard.pid ] && kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null
pkill -f "getForegroundAppInfo" 2>/dev/null
rm -f /home/root/dom-homeguard.sh
[ -x /home/root/dom-blank-home.sh ] && /home/root/dom-blank-home.sh off
rm -f /var/lib/webosbrew/init.d/06-dom-blank-home /home/root/dom-blank-home.sh /home/root/dom-ctl.sh /home/root/dom-disabled
luna-send-pub -w 20000 -i 'luna://com.webos.appInstallService/dev/remove' "{\"id\":\"$APPID\",\"subscribe\":true}" &
sleep 8; kill $! 2>/dev/null || true
echo "Uklonjeno. Home tipka opet otvara LG Home."
