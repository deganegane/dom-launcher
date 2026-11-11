#!/bin/sh
# Uklanja Dom launcher i autostart. LG Home ostaje netaknut.
APPID="com.deganegane.dom"
rm -f /var/lib/webosbrew/init.d/90-dom-launcher
[ -f /tmp/dom-homeguard.pid ] && kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null
pkill -f "getForegroundAppInfo" 2>/dev/null
pkill -f "getPowerState" 2>/dev/null
pkill -f "registerScreenSaverRequest" 2>/dev/null
rm -f /home/root/dom-homeguard.sh
[ -x /home/root/dom-blank-home.sh ] && /home/root/dom-blank-home.sh off
rm -f /var/lib/webosbrew/init.d/06-dom-blank-home /home/root/dom-blank-home.sh /home/root/dom-ctl.sh /home/root/dom-disabled
[ -x /home/root/dom-tune.sh ] && /home/root/dom-tune.sh off >/dev/null 2>&1
rm -f /var/lib/webosbrew/init.d/07-dom-tune /home/root/dom-tune.sh /home/root/dom-tune.conf /home/root/dom-tune-safe /home/root/.dom-tune-pending /home/root/dom-install.sh /home/root/dom-saver /home/root/.dom-country /home/root/.dom-liveplus-prev
luna-send-pub -w 20000 -i 'luna://com.webos.appInstallService/dev/remove' "{\"id\":\"$APPID\",\"subscribe\":true}" &
sleep 8; kill $! 2>/dev/null || true
echo "Uklonjeno. Home tipka opet otvara LG Home."
