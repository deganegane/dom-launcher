#!/bin/sh
# Dom home guard: whenever LG Home comes to the foreground (Home button, boot,
# exiting an app), bring Dom to the front instead.
# To open LG Home on purpose, Dom creates /tmp/dom-allow-home first.
# Polls instead of subscribing: luna-send block-buffers its output in a pipe.
APPID="com.deganegane.dom"
HOME_ID="com.webos.app.home"
FLAG="/tmp/dom-allow-home"
LOG="/tmp/dom-homeguard.log"
echo $$ > /tmp/dom-homeguard.pid
echo "$(date +%T) start" >> "$LOG"

last=""
while true; do
  out=$(luna-send -n 1 -w 1500 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null)
  app=$(echo "$out" | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')
  if [ "$app" != "$last" ]; then
    last="$app"
    echo "$(date +%T) foreground: ${app:-?}" >> "$LOG"
    if [ "$(wc -l < "$LOG")" -gt 300 ]; then tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
    if [ "$app" = "$HOME_ID" ]; then
      if [ -f "$FLAG" ]; then
        rm -f "$FLAG"
        echo "$(date +%T) LG Home allowed" >> "$LOG"
      else
        luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1
        echo "$(date +%T) -> launched Dom" >> "$LOG"
      fi
    fi
  fi
  sleep 0.4 2>/dev/null || sleep 1
done
