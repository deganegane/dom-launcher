#!/bin/sh
# Dom launcher — instalacija na rootani LG webOS TV.
# Pokreni na TV-u (SSH kao root):
#   curl -fsSL https://raw.githubusercontent.com/deganegane/dom-launcher/main/scripts/install.sh | sh
set -e

REPO="deganegane/dom-launcher"
APPID="com.deganegane.dom"
IPK_URL="https://github.com/$REPO/releases/latest/download/$APPID.ipk"
IPK="/tmp/$APPID.ipk"
INITD="/var/lib/webosbrew/init.d"
LOG="/tmp/dom-install.log"

echo "==> Preuzimam $IPK_URL"
curl -fL -o "$IPK" "$IPK_URL"

echo "==> Instaliram"
rm -f "$LOG"
luna-send-pub -w 60000 -i 'luna://com.webos.appInstallService/dev/install' \
  "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$IPK\",\"subscribe\":true}" > "$LOG" 2>&1 &
PID=$!
OK=0
i=0
while [ $i -lt 60 ]; do
  sleep 1
  i=$((i + 1))
  if grep -q '"installed"' "$LOG" 2>/dev/null; then OK=1; break; fi
  if grep -qi '"failed"\|errorText' "$LOG" 2>/dev/null; then break; fi
done
kill $PID 2>/dev/null || true
if [ $OK -ne 1 ]; then
  echo "!! Instalacija nije uspjela:"; cat "$LOG"; exit 1
fi
rm -f "$IPK"

echo "==> Autostart pri paljenju TV-a"
mkdir -p "$INITD"
cat > "$INITD/90-dom-launcher" <<EOF
#!/bin/sh
# Pokreni Dom launcher nakon paljenja TV-a
(
  sleep 15
  luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"$APPID"}' >/dev/null 2>&1
) &
EOF
chmod +x "$INITD/90-dom-launcher"

echo "==> Pokrećem Dom"
luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1 || true

echo
echo "Gotovo. Ostaje još preusmjeriti Home tipku (vidi README: LG Input Hook)."
