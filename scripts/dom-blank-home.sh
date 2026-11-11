#!/bin/sh
# Dom: make LG Home draw nothing, so returning from an app doesn't flash LG's
# home screen before Dom appears. A bind mount only - nothing is changed on
# disk; `off` (or deleting /var/lib/webosbrew/init.d/06-dom-blank-home and
# rebooting) restores LG Home.
#   dom-blank-home.sh on|off
#   dom-blank-home.sh check    after `on`: does LG Home still start? If not, step back to a layout that keeps more of LG's pages
#   dom-blank-home.sh level [1|2|3]   show or force the level
# Levels, most hidden first:
#   1  one empty page (no left page, so no handle for it at the screen edge)
#   2  two pages, both empty
#   3  two pages, the left one is LG's widget page ("My Page")
T=/usr/palm/applications/com.webos.app.home/data/flutter_assets/assets/home.xml
D=/home/root/dom-home
X=$D/home.xml
LV=$D/level
HOME_ID=com.webos.app.home
mounted() { grep -q " $T " /proc/mounts; }
home_alive() {
  if command -v pgrep >/dev/null 2>&1; then pgrep -f "flutter-client -i $HOME_ID" >/dev/null 2>&1
  else ps 2>/dev/null | grep -v grep | grep -q "flutter-client -i $HOME_ID"; fi
}
level() {
  l=$(cat "$LV" 2>/dev/null)
  case "$l" in 1|2|3) echo "$l" ;; *) echo 1 ;; esac
}
write_xml() {
  EMPTY='<item id="margin" itemWidth="3840" itemHeight="60" focusType="none"/>'
  case "$(level)" in
    1) body="	<layout windowType=\"overlay\" pageType=\"none\" pageCount=\"1\" defaultPage=\"0\">
		<page pageBodyType=\"container\">
			$EMPTY
		</page>
	</layout>" ;;
    2) body="	<layout windowType=\"overlay\" pageType=\"none\" pageCount=\"2\" defaultPage=\"1\">
		<page pageBodyType=\"container\">
			$EMPTY
		</page>
		<page pageBodyType=\"container\">
			$EMPTY
		</page>
	</layout>" ;;
    *) body="	<layout windowType=\"overlay\" pageType=\"none\" pageCount=\"2\" defaultPage=\"1\">
		<page pageBodyType=\"container\">
			<item id=\"mypage\" itemWidth=\"3840\" itemHeight=\"2160\" focusType=\"scope\" autoFocus=\"false\"/>
		</page>
		<page pageBodyType=\"container\">
			$EMPTY
		</page>
	</layout>" ;;
  esac
  printf '%s\n%s\n%s\n%s\n' '<?xml version="1.0" encoding="utf-8"?>' '<home version="2.0">' "$body" '</home>' > "$X.new"
  if cmp -s "$X.new" "$X" 2>/dev/null; then : > "$X.new"; return 1; fi
  # in place: the file may already be bind-mounted over LG's
  cat "$X.new" > "$X"; : > "$X.new"
  return 0
}
starts() {   # LG Home has to come up within a few seconds and still be there a moment later
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_ID\"}" >/dev/null 2>&1 </dev/null
  i=0
  while [ $i -lt 8 ]; do
    sleep 1; i=$((i + 1))
    if home_alive; then sleep 2; home_alive && return 0; return 1; fi
  done
  return 1
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
    while :; do
      l=$(level)
      if starts; then
        case "$l" in
          1) echo "LG Home: skriveno sve, i lijeva stranica s widgetima (razina 1)" ;;
          2) echo "LG Home: lijeva stranica je prazna, ali i dalje postoji (razina 2)" ;;
          *) echo "LG Home: stranica s widgetima je morala ostati (razina 3)" ;;
        esac
        break
      fi
      [ "$l" -ge 3 ] && { echo "LG Home se ne pokreće ni s izvornom lijevom stranicom"; break; }
      echo $((l + 1)) > "$LV"
      write_xml
      pkill -f "$HOME_ID"
      sleep 1
    done
    ;;
  level)
    case "$2" in
      1|2|3) mkdir -p "$D"; echo "$2" > "$LV"; mounted && write_xml && pkill -f "$HOME_ID"; echo "razina $2" ;;
      *) echo "razina $(level)" ;;
    esac
    ;;
  off)
    mounted || exit 0
    umount "$T" && pkill -f "$HOME_ID"
    ;;
esac
exit 0
