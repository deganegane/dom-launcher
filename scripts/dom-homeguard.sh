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

log() {
  echo "$(date +%T) $*" >> "$LOG"
  if [ "$(wc -l < "$LOG")" -gt 300 ]; then tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}
launch_dom() {
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1
}

last=""
allowed=0   # LG Home was opened on purpose
tries=0     # launch attempts while LG Home stays in front
ticks=0
while true; do
  out=$(luna-send -n 1 -w 1500 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null)
  app=$(echo "$out" | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')
  if [ "$app" != "$last" ]; then
    last="$app"
    log "foreground: ${app:-?}"
    tries=0; ticks=0; allowed=0
    if [ "$app" = "$HOME_ID" ]; then
      if [ -f "$FLAG" ]; then
        rm -f "$FLAG"; allowed=1
        log "LG Home allowed"
      else
        launch_dom; tries=1
        log "-> launched Dom"
      fi
    fi
  elif [ "$app" = "$HOME_ID" ] && [ $allowed -eq 0 ] && [ $tries -gt 0 ] && [ $tries -lt 4 ]; then
    # Dom didn't come up yet: retry every ~1.2s, at most 3 more times
    ticks=$((ticks + 1))
    if [ $ticks -ge 3 ]; then
      ticks=0; tries=$((tries + 1))
      launch_dom
      log "-> retry $tries"
    fi
  fi
  sleep 0.4 2>/dev/null || sleep 1
done
