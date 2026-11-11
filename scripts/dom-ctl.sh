#!/bin/sh
# Dom control:
#   dom-ctl.sh off      Home button goes back to LG Home (Dom stays installed as a normal app)
#   dom-ctl.sh on       Dom takes over the Home button again
#   dom-ctl.sh lghome   open the original LG Home once
#   dom-ctl.sh screenoff          picture off, sound stays (any key brings it back)
#   dom-ctl.sh sleep <minutes>    switch the TV off after that long (0 = cancel)
#   dom-ctl.sh update             install the newest Dom in the background
#   dom-ctl.sh backup <base64>    keep Dom's settings (from the app), icons, backgrounds and the pairing key
#   dom-ctl.sh restore            print the saved settings
#   dom-ctl.sh pinreset           forget the Settings PIN
FLAG=/home/root/dom-disabled
ALLOW=/tmp/dom-allow-home
HOME_ID=com.webos.app.home
stop_guard() {
  [ -f /tmp/dom-homeguard.pid ] && kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null
  pkill -f dom-homeguard.sh 2>/dev/null
  pkill -f getForegroundAppInfo 2>/dev/null
  pkill -f getPowerState 2>/dev/null
  pkill -f registerScreenSaverRequest 2>/dev/null
}
launch_home() { luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_ID\"}" >/dev/null 2>&1; }
case "$1" in
  off)
    touch "$FLAG"
    stop_guard
    /home/root/dom-blank-home.sh off
    ;;
  on)
    rm -f "$FLAG"
    stop_guard
    nohup /home/root/dom-homeguard.sh >/dev/null 2>&1 &
    /home/root/dom-blank-home.sh on
    ;;
  lghome)
    touch "$ALLOW"
    # restoring LG Home's layout restarts it; give it a moment before opening it
    if grep -q " /usr/palm/applications/$HOME_ID/data/flutter_assets/assets/home.xml " /proc/mounts; then
      /home/root/dom-blank-home.sh off
      sleep 1.5 2>/dev/null || sleep 2
    fi
    launch_home
    sleep 1.5 2>/dev/null || sleep 2
    if [ "$(cat /tmp/dom-fg 2>/dev/null)" != "$HOME_ID" ]; then touch "$ALLOW"; launch_home; fi
    ;;
  screenoff)
    luna-send -n 1 luna://com.webos.service.tvpower/power/turnOffScreen '{}' >/dev/null 2>&1
    ;;
  poweroff)
    # which call switches the TV off differs between webOS versions: try them in turn
    for u in luna://com.webos.service.tvpower/power/powerOff luna://com.webos.service.tvpower/power/turnOff luna://com.webos.service.power/shutdown/machineOff; do
      out=$(luna-send -n 1 -w 4000 "$u" '{"reason":"remoteKey"}' 2>&1)
      case "$out" in *'"returnValue": true'*|*'"returnValue":true'*) exit 0 ;; esac
    done
    NODE=$(command -v node || ls /usr/bin/node /usr/local/bin/node 2>/dev/null | head -1)
    [ -n "$NODE" ] && "$NODE" /home/root/dom-keys.js off >/dev/null 2>&1
    ;;
  sleep)
    [ -f /tmp/dom-sleep.pid ] && kill "$(cat /tmp/dom-sleep.pid)" 2>/dev/null
    rm -f /tmp/dom-sleep.pid
    case "$2" in ''|0|*[!0-9]*) exit 0 ;; esac
    nohup sh -c "sleep $(($2 * 60)); rm -f /tmp/dom-sleep.pid; /home/root/dom-ctl.sh poweroff" >/dev/null 2>&1 &
    echo $! > /tmp/dom-sleep.pid
    ;;
  pinreset)
    touch /home/root/dom-pin-reset
    echo "PIN se briše kad sljedeći put otvoriš Dom."
    ;;
  update)
    [ -x /home/root/dom-install.sh ] || exit 1
    nohup /home/root/dom-install.sh > /tmp/dom-update.log 2>&1 &
    ;;
  backup)
    B=/home/root/dom-backup
    mkdir -p "$B"
    echo "$2" | base64 -d > "$B/settings.json" 2>/dev/null || exit 1
    cd /home/root || exit 1
    list=""
    for f in dom-icons dom-backgrounds dom-ssap-key dom-ssap-endpoint dom-stremio-keys.txt dom-capture-method dom-tune.conf dom-home/level; do [ -e "$f" ] && list="$list $f"; done
    # shellcheck disable=SC2086
    tar czf "$B/dom-files.tar.gz" $list 2>/dev/null
    echo OK
    ;;
  restore)
    B=/home/root/dom-backup
    [ -s "$B/settings.json" ] || exit 1
    [ -s "$B/dom-files.tar.gz" ] && tar xzf "$B/dom-files.tar.gz" -C /home/root 2>/dev/null
    cat "$B/settings.json"
    ;;
esac
exit 0
