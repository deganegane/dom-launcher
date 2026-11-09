#!/bin/sh
# Dom home guard: whenever LG Home comes to the foreground (Home button, boot,
# exiting an app), bring Dom to the front instead.
# To open LG Home on purpose, Dom creates /tmp/dom-allow-home first.
APPID="com.deganegane.dom"
FLAG="/tmp/dom-allow-home"
echo $$ > /tmp/dom-homeguard.pid

while true; do
  luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null |
  while read -r line; do
    case "$line" in
      *'com.webos.app.home"'*)
        if [ -f "$FLAG" ]; then
          rm -f "$FLAG"
          continue
        fi
        luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1
        ;;
    esac
  done
  sleep 3
done
