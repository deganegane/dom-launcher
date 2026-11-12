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
#   dom-ctl.sh stats <day> <week> seconds on screen per app since those unix times ("D app s", "W app s")
#   dom-ctl.sh health             one line per check, for Settings > Sustav > Stanje sustava
#   dom-ctl.sh restart            start the home guard and the helper again
#   dom-ctl.sh rollback           put the previous version of Dom back
#   dom-ctl.sh web on|off|status  the phone page (served by dom-agent.js)
#   dom-ctl.sh agent start|stop   the background helper (phone page, new-episode notices, consoles)
FLAG=/home/root/dom-disabled
ALLOW=/tmp/dom-allow-home
HOME_ID=com.webos.app.home
stop_guard() {
  [ -f /tmp/dom-homeguard.pid ] && kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null
  pkill -f dom-homeguard.sh 2>/dev/null
  pkill -f getForegroundAppInfo 2>/dev/null
  pkill -f getPowerState 2>/dev/null
  pkill -f registerScreenSaverRequest 2>/dev/null
  pkill -f getAppLifeEvents 2>/dev/null
}
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
start_agent() {
  alive /tmp/dom-agent.pid && return 0
  N=$(command -v node || ls /usr/bin/node /usr/local/bin/node 2>/dev/null | head -1)
  [ -n "$N" ] && [ -f /home/root/dom-agent.js ] && nohup "$N" /home/root/dom-agent.js >/dev/null 2>&1 &
  return 0
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
    for f in dom-icons dom-backgrounds dom-ssap-key dom-ssap-endpoint dom-stremio-keys.txt dom-capture-method dom-tune.conf dom-home/level dom-web-token dom-usage.log; do [ -e "$f" ] && list="$list $f"; done
    # shellcheck disable=SC2086
    tar czf "$B/dom-files.tar.gz" $list 2>/dev/null
    echo OK
    ;;
  stats)
    case "$2$3" in ''|*[!0-9]*) exit 1 ;; esac
    [ -f /home/root/dom-usage.log ] || exit 0
    # time between one line and the next belongs to the first; a gap over 4 h is cut (power cut, no "OFF")
    awk -v d0="$2" -v w0="$3" -v now="$(date +%s)" '
      function add(app, a, b,   s) {
        if (app == "" || app == "OFF" || app == "?" || app == "com.deganegane.dom") return
        if (app ~ /^com\.webos\.app\.(home|screensaver|starfish|systemui)/) return
        if (b - a > 14400) b = a + 14400
        s = (a > w0) ? a : w0; if (b > s) W[app] += b - s
        s = (a > d0) ? a : d0; if (b > s) D[app] += b - s
      }
      NF >= 2 && $1 ~ /^[0-9]+$/ { if (pt != "") add(pa, pt, $1); pt = $1; pa = $2 }
      END { if (pt != "") add(pa, pt, now); for (k in D) print "D", k, int(D[k]); for (k in W) print "W", k, int(W[k]) }
    ' /home/root/dom-usage.log
    ;;
  health)
    flag01() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }
    echo "guard=$(flag01 alive /tmp/dom-homeguard.pid)"
    echo "agent=$(flag01 alive /tmp/dom-agent.pid)"
    echo "autostart=$(flag01 test -f /var/lib/webosbrew/init.d/90-dom-launcher)"
    echo "blank=$(flag01 grep -q " /usr/palm/applications/$HOME_ID/data/flutter_assets/assets/home.xml " /proc/mounts)"
    echo "block=$(flag01 grep -q ' /usr/sbin/update ' /proc/mounts)"
    echo "node=$(flag01 sh -c 'command -v node || test -x /usr/bin/node')"
    echo "paired=$(flag01 test -s /home/root/dom-ssap-key)"
    echo "web=$(flag01 test -f /home/root/dom-web-on)"
    echo "notify=$(flag01 test -f /home/root/dom-notify-on)"
    echo "mem=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)"
    echo "disk=$(df -k /home/root 2>/dev/null | tail -1 | awk '{print int($(NF-2)/1024)}')"
    echo "uptime=$(cut -d. -f1 /proc/uptime)"
    [ -s /home/root/dom-backup/previous.ipk ] && echo "prev=$(cat /home/root/dom-backup/previous.ver 2>/dev/null || echo '?')"
    tail -n 5 /tmp/dom-homeguard.log 2>/dev/null | sed 's/^/LOG /'
    grep '^!!' /tmp/dom-update.log 2>/dev/null | tail -n 2 | sed 's/^/LOG nadogradnja: /'
    tail -n 2 /tmp/dom-agent.log 2>/dev/null | sed 's/^/LOG pomoćnik: /'
    ;;
  restart)
    if [ -f "$FLAG" ]; then start_agent; else "$0" on; fi
    ;;
  rollback)
    [ -x /home/root/dom-install.sh ] && [ -s /home/root/dom-backup/previous.ipk ] || exit 1
    nohup /home/root/dom-install.sh rollback > /tmp/dom-update.log 2>&1 &
    ;;
  web)
    case "$2" in
      on) touch /home/root/dom-web-on; start_agent ;;
      off) rm -f /home/root/dom-web-on ;;
      *)
        if [ -f /home/root/dom-web-on ] && alive /tmp/dom-agent.pid && [ -s /tmp/dom-web.json ]; then cat /tmp/dom-web.json
        elif [ -f /home/root/dom-web-on ]; then echo '{"on":true,"url":""}'
        else echo '{"on":false}'; fi
        ;;
    esac
    ;;
  agent)
    case "$2" in
      stop) alive /tmp/dom-agent.pid && kill "$(cat /tmp/dom-agent.pid)"; rm -f /tmp/dom-agent.pid ;;
      *) start_agent ;;
    esac
    ;;
  restore)
    B=/home/root/dom-backup
    [ -s "$B/settings.json" ] || exit 1
    [ -s "$B/dom-files.tar.gz" ] && tar xzf "$B/dom-files.tar.gz" -C /home/root 2>/dev/null
    cat "$B/settings.json"
    ;;
esac
exit 0
