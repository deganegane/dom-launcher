#!/bin/sh
# Dom: make LG Home draw nothing, so returning from an app doesn't flash LG's
# home screen before Dom appears. A bind mount only - nothing is changed on
# disk; `off` (or deleting /var/lib/webosbrew/init.d/06-dom-blank-home and
# rebooting) restores LG Home.
#   dom-blank-home.sh on|off
#   dom-blank-home.sh check    after `on`: does LG Home still start? If not, go back to the layout that keeps LG's widget page
T=/usr/palm/applications/com.webos.app.home/data/flutter_assets/assets/home.xml
D=/home/root/dom-home
X=$D/home.xml
KEEP=$D/keep-widgets      # present = LG Home needs its widget page ("My Page") to start
HOME_ID=com.webos.app.home
mounted() { grep -q " $T " /proc/mounts; }
home_alive() {
  if command -v pgrep >/dev/null 2>&1; then pgrep -f "flutter-client -i $HOME_ID" >/dev/null 2>&1
  else ps 2>/dev/null | grep -v grep | grep -q "flutter-client -i $HOME_ID"; fi
}
write_xml() {
  # the left page: LG's widgets ("mypage"), or just an empty strip
  if [ -f "$KEEP" ]; then
    left='<item id="mypage" itemWidth="3840" itemHeight="2160" focusType="scope" autoFocus="false"/>'
  else
    left='<item id="margin" itemWidth="3840" itemHeight="60" focusType="none"/>'
  fi
  cat > "$X.new" <<XML
<?xml version="1.0" encoding="utf-8"?>
<home version="2.0">
	<layout windowType="overlay" pageType="none" pageCount="2" defaultPage="1">
		<page pageBodyType="container">
			$left
		</page>
		<page pageBodyType="container">
			<item id="margin" itemWidth="3840" itemHeight="60" focusType="none"/>
		</page>
	</layout>
</home>
XML
  if cmp -s "$X.new" "$X" 2>/dev/null; then rm -f "$X.new"; return 1; fi
  # in place: the file may already be bind-mounted over LG's
  cat "$X.new" > "$X"; rm -f "$X.new"
  return 0
}
case "$1" in
  on)
    [ -f /home/root/dom-disabled ] && exit 0
    [ -f "$T" ] || exit 0
    mkdir -p "$D"
    changed=0; write_xml && changed=1
    if ! mounted; then mount --bind "$X" "$T" && changed=1; fi
    [ "$changed" = 1 ] && pkill -f "$HOME_ID"
    ;;
  check)
    mounted || exit 0
    [ -f "$KEEP" ] && exit 0
    luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_ID\"}" >/dev/null 2>&1 </dev/null
    # it has to come up within a few seconds and still be there a moment later
    ok=0; i=0
    while [ $i -lt 8 ]; do sleep 1; i=$((i + 1)); if home_alive; then ok=1; break; fi; done
    if [ "$ok" = 1 ]; then sleep 2; home_alive || ok=0; fi
    if [ "$ok" != 1 ]; then
      touch "$KEEP"
      write_xml
      pkill -f "$HOME_ID"
      echo "LG Home se ne pokreće bez stranice s widgetima; vraćena je."
    else
      echo "LG-ova stranica s widgetima je skrivena."
    fi
    ;;
  off)
    mounted || exit 0
    umount "$T" && pkill -f "$HOME_ID"
    ;;
esac
exit 0
