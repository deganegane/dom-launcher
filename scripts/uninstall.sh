#!/bin/sh
# Uklanja Dom launcher i autostart. LG Home ostaje netaknut.
APPID="com.deganegane.dom"
rm -f /var/lib/webosbrew/init.d/90-dom-launcher
[ -f /tmp/dom-homeguard.pid ] && kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null
pkill -f "getForegroundAppInfo" 2>/dev/null
pkill -f "getPowerState" 2>/dev/null
pkill -f "registerScreenSaverRequest" 2>/dev/null
pkill -f "getAppLifeEvents" 2>/dev/null
rm -f /home/root/dom-homeguard.sh
[ -f /tmp/dom-agent.pid ] && kill "$(cat /tmp/dom-agent.pid)" 2>/dev/null
pkill -f "dom-agent.js" 2>/dev/null
pkill -f "getAllInputStatus" 2>/dev/null
rm -f /var/lib/webosbrew/init.d/91-dom-agent /home/root/dom-agent.js /home/root/dom-web.html /home/root/dom-web-on /home/root/dom-web-token \
  /home/root/dom-notify-on /home/root/dom-stremio-auth /home/root/dom-notified.json /home/root/dom-console-mode /home/root/dom-usage.log /home/root/dom-rolled-back /home/root/dom-autoclose
[ -x /home/root/dom-blank-home.sh ] && /home/root/dom-blank-home.sh off
rm -f /var/lib/webosbrew/init.d/06-dom-blank-home /home/root/dom-blank-home.sh /home/root/dom-ctl.sh /home/root/dom-disabled
[ -x /home/root/dom-tune.sh ] && /home/root/dom-tune.sh off >/dev/null 2>&1
rm -f /var/lib/webosbrew/init.d/07-dom-tune /home/root/dom-tune.sh /home/root/dom-tune.conf /home/root/dom-tune-safe /home/root/.dom-tune-pending /home/root/dom-install.sh /home/root/dom-saver /home/root/dom-spotify.js /home/root/dom-spotify.json /home/root/.dom-country /home/root/.dom-liveplus-prev
luna-send-pub -w 20000 -i 'luna://com.webos.appInstallService/dev/remove' "{\"id\":\"$APPID\",\"subscribe\":true}" &
sleep 8; kill $! 2>/dev/null || true
echo "Uklonjeno. Home tipka opet otvara LG Home."
