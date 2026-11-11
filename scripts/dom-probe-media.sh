#!/bin/sh
# Dom: what does the TV know about the music that is playing?
# Start a song in Spotify, press Home, then run this over SSH and send back the output.
q() {
  echo "== $1 $2"
  luna-send -n 1 -w 4000 "$1" "$2" 2>&1 | cut -c1-1500
}
MC=luna://com.webos.service.mediacontroller
q $MC/getActiveMediaSessions '{}'
ids=$(luna-send -n 1 -w 4000 $MC/getActiveMediaSessions '{}' 2>/dev/null | grep -o '"mediaId" *: *"[^"]*"' | sed 's/.*: *"//; s/"//' | sort -u)
for id in $ids; do
  q $MC/getMediaMetaData "{\"mediaId\":\"$id\"}"
  q $MC/getMediaPlayStatus "{\"mediaId\":\"$id\"}"
  q $MC/getMediaSessionInfo "{\"mediaId\":\"$id\"}"
done
q luna://com.webos.media/getActivePipelines '{}'
q luna://com.webos.service.audio/getVolume '{}' 2>/dev/null
q luna://com.webos.applicationManager/running '{}'
echo "== services with 'media' in the name"
ls /usr/share/luna-service2/services.d /var/luna-service2-dev/services.d 2>/dev/null | grep -i "media\|music\|nowplay" | head -30
echo "== methods of the media controller"
ls-monitor -i com.webos.service.mediacontroller 2>/dev/null | head -60
