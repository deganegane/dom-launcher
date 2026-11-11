#!/bin/sh
# Dom: what does the TV know about the music that is playing?
# Start a song in Spotify, press Home, then run this over SSH and send back the output.
q() {
  echo "== $1 $2"
  # stdin from /dev/null: under "curl | sh" luna-send otherwise prints nothing
  luna-send -n 1 -w 4000 "$1" "$2" </dev/null 2>&1 | cut -c1-1800
}
q luna://com.webos.media/getActivePipelines '{}'
q luna://com.webos.media/getForegroundAppInfo '{}'
q luna://com.webos.applicationManager/running '{}'
q luna://com.webos.applicationManager/getForegroundAppInfo '{"extraInfo":true}'
q luna://com.webos.service.audio/getStatus '{}'
q luna://com.webos.audio/getVolume '{}'
q luna://com.webos.service.mediasync/getStatus '{}'
echo "== hub services that could know about playback"
ls-monitor -l </dev/null 2>/dev/null | grep -i "media\|music\|play\|sound\|audio\|spotify\|umedia\|avoutput\|videooutput" | cut -c1-160 | head -50
for s in com.webos.media com.webos.service.mediasync; do
  echo "== methods of $s"
  ls-monitor -i "$s" </dev/null 2>/dev/null | grep -v "^$" | cut -c1-160 | head -70
done
echo "== Spotify processes"
ps 2>/dev/null | grep -i spotify | grep -v grep | cut -c1-200 | head -5
