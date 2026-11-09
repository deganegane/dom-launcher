#!/bin/sh
# Dom home guard:
#  - whenever LG Home comes to the foreground (Home button, boot, exiting an
#    app), bring Dom to the front instead. To open LG Home on purpose, Dom
#    creates /tmp/dom-allow-home first.
#  - while another app is in front, grab a frame of the screen every ~20s so
#    Dom can show "what you were just watching" as that app's background.
# Polls instead of subscribing: luna-send block-buffers its output in a pipe.
APPID="com.deganegane.dom"
HOME_ID="com.webos.app.home"
FLAG="/tmp/dom-allow-home"
LOG="/tmp/dom-homeguard.log"
SHOTS="/home/root/dom-shots"
mkdir -p "$SHOTS"
echo $$ > /tmp/dom-homeguard.pid

log() {
  echo "$(date +%T) $*" >> "$LOG"
  if [ "$(wc -l < "$LOG")" -gt 300 ]; then tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}
launch_dom() {
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1
}
# Save a screen frame for app $1. DRM video (Netflix etc.) captures as black,
# which compresses to a tiny file, so small captures are thrown away.
capture() {
  tmp="/tmp/dom-cap.jpg"
  rm -f "$tmp"
  for svc in com.webos.service.capture com.webos.service.tv.capture; do
    luna-send -n 1 -w 6000 "luna://$svc/executeOneShot" \
      "{\"path\":\"$tmp\",\"method\":\"DISPLAY\",\"format\":\"JPG\",\"width\":1280,\"height\":720}" >/dev/null 2>&1
    [ -s "$tmp" ] && break
  done
  [ -s "$tmp" ] || return 0
  size=$(wc -c < "$tmp")
  if [ "$size" -gt 60000 ]; then
    mv -f "$tmp" "$SHOTS/$1.jpg"
  else
    rm -f "$tmp"
  fi
}
skip_capture() {
  case "$1" in
    ""|"$APPID"|"$HOME_ID"|com.webos.app.screensaver|com.palm.app.settings|org.webosbrew.*|com.webos.app.*setting*) return 0 ;;
  esac
  return 1
}

log "start"
last=""
allowed=0   # LG Home was opened on purpose
tries=0     # launch attempts while LG Home stays in front
ticks=0
cap=0       # polls since last capture
while true; do
  out=$(luna-send -n 1 -w 1500 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null)
  app=$(echo "$out" | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')
  if [ "$app" != "$last" ]; then
    last="$app"
    log "foreground: ${app:-?}"
    tries=0; ticks=0; allowed=0; cap=30   # first frame ~8s after an app opens
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
  elif ! skip_capture "$app"; then
    cap=$((cap + 1))
    if [ $cap -ge 50 ]; then
      cap=0
      capture "$app"
    fi
  fi
  sleep 0.4 2>/dev/null || sleep 1
done
