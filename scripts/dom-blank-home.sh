#!/bin/sh
# Dom: make LG Home draw nothing, so returning from an app doesn't flash LG's
# home screen before Dom appears. A bind mount only - nothing is changed on
# disk; `off` (or deleting /var/lib/webosbrew/init.d/06-dom-blank-home and
# rebooting) restores LG Home.
#   dom-blank-home.sh on|off
T=/usr/palm/applications/com.webos.app.home/data/flutter_assets/assets/home.xml
X=/home/root/dom-home/home.xml
mounted() { grep -q " $T " /proc/mounts; }
case "$1" in
  on)
    [ -f "$T" ] || exit 0
    mounted && exit 0
    mkdir -p /home/root/dom-home
    cat > "$X" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<home version="2.0">
	<layout windowType="overlay" pageType="none" pageCount="2" defaultPage="1">
		<page pageBodyType="container">
			<item id="mypage" itemWidth="3840" itemHeight="2160" focusType="scope" autoFocus="false"/>
		</page>
		<page pageBodyType="container">
			<item id="margin" itemWidth="3840" itemHeight="60" focusType="none"/>
		</page>
	</layout>
</home>
XML
    mount --bind "$X" "$T" && pkill -f com.webos.app.home
    ;;
  off)
    mounted || exit 0
    umount "$T" && pkill -f com.webos.app.home
    ;;
esac
exit 0
