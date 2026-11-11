#!/bin/sh
# Dom: what does the TV do when Back is held? Run over SSH with Dom on screen, then follow the three steps.
echo "Imaš 30 sekundi. Na daljinskom:"
echo "  1) DUGO drži Natrag (2-3 sekunde) i pusti"
echo "  2) pričekaj 5 sekundi"
echo "  3) kratko stisni Home"
echo "---"
stamp() { while read -r l; do echo "$(date +%H:%M:%S) $1 $l" | cut -c1-700; done; }
# which app (and window) is in front, with the parameters it was opened with
luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true,"extraInfo":true}' </dev/null 2>&1 | stamp FG &
# every app start and stop
luna-send -i luna://com.webos.applicationManager/getAppLifeEvents '{"subscribe":true}' </dev/null 2>&1 | stamp LIFE &
sleep 30
pkill -f '"extraInfo":true' 2>/dev/null
pkill -f getAppLifeEvents 2>/dev/null
echo "--- gotovo, pošalji mi cijeli ispis"
