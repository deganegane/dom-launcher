#!/bin/sh
# Dom home guard:
#  - whenever LG Home comes to the foreground (Home button, boot, exiting an
#    app), bring Dom to the front instead. To open LG Home on purpose, Dom
#    creates /tmp/dom-allow-home first.
#  - while another app is in front, grab a frame of the screen every ~20s so
#    Dom can show "what you were just watching" as that app's background.
APPID="com.deganegane.dom"
HOME_ID="com.webos.app.home"
FLAG="/tmp/dom-allow-home"
LOG="/tmp/dom-homeguard.log"
SHOTS="/home/root/dom-shots"
# VIDEO = only the video plane (no app menus/UI). Menus without playing video
# capture as black and are discarded. Override: echo DISPLAY > /home/root/dom-capture-method
CAPTURE_METHOD=$(cat /home/root/dom-capture-method 2>/dev/null || echo VIDEO)
mkdir -p "$SHOTS"
echo $$ > /tmp/dom-homeguard.pid

log() {
  echo "$(date +%T) $*" >> "$LOG"
  if [ "$(wc -l < "$LOG")" -gt 300 ]; then tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}
launch_dom() {
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1
}
# Save a frame of the playing video for app $1. DRM video (Netflix etc.) captures as black,
# which compresses to a tiny file, so small captures are thrown away.
capture() {
  tmp="/tmp/dom-cap.jpg"
  rm -f "$tmp"
  for svc in com.webos.service.capture com.webos.service.tv.capture; do
    luna-send -n 1 -w 6000 "luna://$svc/executeOneShot" \
      "{\"path\":\"$tmp\",\"method\":\"$CAPTURE_METHOD\",\"format\":\"JPG\",\"width\":1280,\"height\":720}" >/dev/null 2>&1
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
FG="/tmp/dom-fg"
: > "$FG"

# --- frames of what is being watched: first one ~8s after an app opens, then every ~20s
(
  lastfg=""; n=0
  while true; do
    sleep 4
    fg=$(cat "$FG" 2>/dev/null)
    if [ "$fg" != "$lastfg" ]; then lastfg="$fg"; n=0; fi
    n=$((n + 1))
    if ! skip_capture "$fg" && [ $((n % 5)) -eq 2 ]; then capture "$fg"; fi
  done
) &

# --- Dom's own screensaver: while it is switched on (flag file) and Dom is on screen, LG's screensaver is declined
(
  while true; do
    luna-send -i luna://com.webos.service.tvpower/power/registerScreenSaverRequest '{"subscribe":true,"clientName":"dom"}' 2>/dev/null |
    while read -r line; do
      ts=$(echo "$line" | sed -n 's/.*"timestamp" *: *"\([^"]*\)".*/\1/p')
      [ -n "$ts" ] || continue
      if [ -f /home/root/dom-saver ] && [ "$(cat "$FG" 2>/dev/null)" = "$APPID" ]; then ack=false; else ack=true; fi
      luna-send -n 1 luna://com.webos.service.tvpower/power/responseScreenSaverRequest "{\"clientName\":\"dom\",\"ack\":$ack,\"timestamp\":\"$ts\"}" >/dev/null 2>&1
    done
    sleep 5
  done
) &

# --- old-TV power-off effect: tell Dom the moment the power key is pressed, if Dom is what's on screen
(
  while true; do
    luna-send -i luna://com.webos.service.tvpower/power/getPowerState '{"subscribe":true}' 2>/dev/null |
    while read -r line; do
      case "$line" in
        *'"Request Power Off"'*)
          [ "$(cat "$FG" 2>/dev/null)" = "$APPID" ] &&
            luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\",\"params\":{\"dom\":\"poweroff\"}}" >/dev/null 2>&1
          ;;
      esac
    done
    sleep 2
  done
) &

# --- Home: the system tells us the moment the foreground app changes (subscription),
#     so Dom is brought up right away instead of at the next poll.
while true; do
  luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null |
  while read -r line; do
    app=$(echo "$line" | sed -n 's/.*"appId" *: *"\([^"]*\)".*/\1/p')
    [ "$app" = "$(cat "$FG" 2>/dev/null)" ] && continue
    echo "$app" > "$FG"
    log "foreground: ${app:-?}"
    if [ "$app" = "$HOME_ID" ]; then
      if [ -f "$FLAG" ]; then
        rm -f "$FLAG"
        log "LG Home allowed"
      else
        launch_dom
        log "-> launched Dom"
        # if LG Home is somehow still in front, try a few more times
        (
          for t in 2 3 4; do
            sleep 1.2 2>/dev/null || sleep 1
            [ "$(cat "$FG" 2>/dev/null)" = "$HOME_ID" ] || exit 0
            launch_dom; log "-> retry $t"
          done
        ) &
      fi
    fi
  done
  log "subscription ended, restarting"
  sleep 2
done
