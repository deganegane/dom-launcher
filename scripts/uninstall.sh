#!/bin/sh
# Uklanja Dom launcher i autostart. LG Home ostaje netaknut.
APPID="com.deganegane.dom"
rm -f /var/lib/webosbrew/init.d/90-dom-launcher
luna-send-pub -w 20000 -i 'luna://com.webos.appInstallService/dev/remove' "{\"id\":\"$APPID\",\"subscribe\":true}" &
sleep 8; kill $! 2>/dev/null || true
echo "Uklonjeno. Ne zaboravi maknuti Home keybind u LG Input Hooku."
