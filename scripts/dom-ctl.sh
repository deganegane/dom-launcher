#!/bin/sh
# Dom control:
#   dom-ctl.sh off      Home button goes back to LG Home (Dom stays installed as a normal app)
#   dom-ctl.sh on       Dom takes over the Home button again
#   dom-ctl.sh lghome   open the original LG Home once
FLAG=/home/root/dom-disabled
ALLOW=/tmp/dom-allow-home
HOME_ID=com.webos.app.home
stop_guard() {
  [ -f /tmp/dom-homeguard.pid ] && kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null
  pkill -f dom-homeguard.sh 2>/dev/null
  pkill -f getForegroundAppInfo 2>/dev/null
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
esac
exit 0
