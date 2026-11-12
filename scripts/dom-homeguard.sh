#!/bin/sh
# Dom home guard:
#  - whenever LG Home comes to the foreground (Home button, boot, exiting an
#    app), bring Dom to the front instead. To open LG Home on purpose, Dom
#    creates /tmp/dom-allow-home first.
#  - while another app is in front, grab a frame of the screen every ~20s so
#    Dom can show "what you were just watching" as that app's background.
#  - keep a log of what is on screen (Statistika gledanja), end the time of the
#    kids' profile, and keep the background helper (dom-agent.js) running.
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
RECENTS="/tmp/dom-recents"
launch_dom() {
  # right after a long press of Back (see below) Dom opens straight into its list of open apps
  params="{}"
  if [ $(( $(date +%s) - $(cat "$RECENTS" 2>/dev/null || echo 0) )) -lt 6 ]; then params='{"dom":"recents"}'; fi
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\",\"params\":$params}" >/dev/null 2>&1
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

USAGE="/home/root/dom-usage.log"
# one line per change of what is on screen: "<unix time> <app id>", "OFF" when the TV goes off
usage() {
  echo "$(date +%s) $1" >> "$USAGE"
  if [ "$(wc -l < "$USAGE")" -gt 6000 ]; then tail -n 4000 "$USAGE" > "$USAGE.tmp" && mv "$USAGE.tmp" "$USAGE"; fi
}
KIDS="/tmp/dom-kids-deadline"
AGENT="/home/root/dom-agent.js"
start_agent() {
  [ -f /tmp/dom-agent.pid ] && kill -0 "$(cat /tmp/dom-agent.pid)" 2>/dev/null && return 0
  N=$(command -v node || ls /usr/bin/node /usr/local/bin/node 2>/dev/null | head -1)
  [ -n "$N" ] && [ -f "$AGENT" ] && nohup "$N" "$AGENT" >/dev/null 2>&1 &
}

log "start"
FG="/tmp/dom-fg"
: > "$FG"
start_agent

# --- frames of what is being watched: first one ~8s after an app opens, then every ~20s
(
  lastfg=""; n=0
  while true; do
    sleep 4
    fg=$(cat "$FG" 2>/dev/null)
    if [ "$fg" != "$lastfg" ]; then lastfg="$fg"; n=0; fi
    n=$((n + 1))
    if ! skip_capture "$fg" && [ $((n % 5)) -eq 2 ]; then capture "$fg"; fi
    # kids' profile: when the day's time is up, Dom comes back over whatever is playing
    if [ -f "$KIDS" ] && [ "$(date +%s)" -ge "$(cat "$KIDS" 2>/dev/null || echo 9999999999)" ] && [ "$fg" != "$APPID" ]; then
      rm -f "$KIDS"; log "kids: time is up"
      luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\",\"params\":{\"dom\":\"kidslimit\"}}" >/dev/null 2>&1
    fi
    # "Nadogradi Dom" in Settings: started from here, outside Homebrew Channel's service (see dom-ctl.sh)
    if [ -f /tmp/dom-update-request ]; then
      what=$(cat /tmp/dom-update-request 2>/dev/null); log "update requested ($what)"
      /home/root/dom-ctl.sh run-install "$what"
    fi
    # the background helper died: start it again (once a minute at most)
    [ $((n % 15)) -eq 0 ] && start_agent
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

# --- holding Back makes the system close the app in front ("windowPolicy"). When that app is Dom,
#     start it again at once, opened on the list of open apps - the same gesture LG Home uses for recents.
(
  while true; do
    luna-send -i luna://com.webos.applicationManager/getAppLifeEvents '{"subscribe":true}' 2>/dev/null |
    while read -r line; do
      case "$line" in
        *'"event":"close"'*"\"appId\":\"$APPID\""*'"reason":"windowPolicy"'*)
          date +%s > "$RECENTS"
          log "Back held on Dom -> open apps"
          launch_dom </dev/null
          ;;
      esac
    done
    sleep 2
  done
) &

# --- old-TV power-off effect: tell Dom the moment the power key is pressed, if Dom is what's on screen
(
  while true; do
    luna-send -i luna://com.webos.service.tvpower/power/getPowerState '{"subscribe":true}' 2>/dev/null |
    while read -r line; do
      case "$line" in
        *'"Request Power Off"'*)
          usage OFF
          [ "$(cat "$FG" 2>/dev/null)" = "$APPID" ] &&
            luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\",\"params\":{\"dom\":\"poweroff\"}}" >/dev/null 2>&1
          ;;
        *'"state"'*'"Active"'*)
          # back on: what is on screen counts again from now
          case "$line" in *processing*) ;; *) f=$(cat "$FG" 2>/dev/null); [ -n "$f" ] && usage "$f" ;; esac
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
    usage "${app:-?}"
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
