#!/bin/sh
# Dom launcher — instalacija na rootani LG webOS TV.
# Pokreni na TV-u (SSH kao root):
#   curl -fsSL "https://raw.githubusercontent.com/deganegane/dom-launcher/main/scripts/install.sh?$(date +%s)" | sh
# /home/root/dom-install.sh rollback   vraća prethodnu verziju (Postavke › Sustav › Stanje sustava)
set -e
MODE="${1:-install}"
NOCACHE="?$(date +%s)"   # raw.githubusercontent caches files for ~5 min

REPO="deganegane/dom-launcher"
APPID="com.deganegane.dom"
# DOM_IPK_URL=<address> installs a specific package instead of the latest release
IPK_URL="${DOM_IPK_URL:-https://github.com/$REPO/releases/latest/download/$APPID.ipk}"
IPK="/tmp/$APPID.ipk"
INITD="/var/lib/webosbrew/init.d"
LOG="/tmp/dom-install.log"

# The TV's DNS sometimes refuses GitHub (ad blockers, flaky resolver). When a normal download
# fails, ask 1.1.1.1 for the address over HTTPS and follow redirects by hand, one host at a time.
doh_ip() {
  curl -fsS -m 8 -H 'accept: application/dns-json' "https://1.1.1.1/dns-query?name=$1&type=A" 2>/dev/null \
    | grep -oE '"data":"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'
}
fetch() {  # fetch <url> <file>
  curl -fsSL -m 180 -o "$2" "$1" 2>/dev/null && return 0
  echo "   (DNS ne radi za ovu adresu, idem zaobilazno)"
  f_url=$1; f_n=0
  while [ $f_n -lt 6 ]; do
    f_n=$((f_n + 1))
    f_host=$(echo "$f_url" | sed 's#^https://\([^/:]*\).*#\1#')
    f_ip=$(doh_ip "$f_host") || true
    [ -n "$f_ip" ] || return 1
    f_res=$(curl -sS -m 180 --resolve "$f_host:443:$f_ip" -o "$2" -w '%{http_code} %{redirect_url}' "$f_url") || return 1
    case "$f_res" in
      200*) return 0 ;;
      3*) f_url=${f_res#* }; [ -n "$f_url" ] || return 1 ;;
      *) return 1 ;;
    esac
  done
  return 1
}

# install_ipk <file>: hand a package to the TV's installer and wait for the answer
install_ipk() {
  rm -f "$LOG"
  luna-send-pub -w 60000 -i 'luna://com.webos.appInstallService/dev/install' \
    "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$1\",\"subscribe\":true}" > "$LOG" 2>&1 &
  i_pid=$!
  i_ok=0; i=0
  while [ $i -lt 60 ]; do
    sleep 1
    i=$((i + 1))
    if grep -q '"installed"' "$LOG" 2>/dev/null; then i_ok=1; break; fi
    if grep -qi '"failed"\|errorText' "$LOG" 2>/dev/null; then break; fi
  done
  kill $i_pid 2>/dev/null || true
  [ $i_ok -eq 1 ]
}
installed_ver() {
  for d in /media/developer/apps/usr/palm/applications/$APPID /media/cryptofs/apps/usr/palm/applications/$APPID; do
    [ -f "$d/appinfo.json" ] && sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$d/appinfo.json" | head -1 && return 0
  done
  echo "?"
}
relaunch() {
  # close the running copy so the new version is actually loaded
  luna-send -n 1 luna://com.webos.service.applicationManager/closeByAppId "{\"id\":\"$APPID\"}" >/dev/null 2>&1 || true
  sleep 1
  rm -f /tmp/dom-alive
  luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APPID\"}" >/dev/null 2>&1 || true
}
# the last two packages are kept, so a version that does not start can be undone
BK=/home/root/dom-backup
mkdir -p "$BK"
rollback() {
  [ -s "$BK/previous.ipk" ] || { echo "!! Nema prethodne verzije"; return 1; }
  echo "==> Vraćam verziju $(cat "$BK/previous.ver" 2>/dev/null)"
  cp -f "$BK/previous.ipk" "/tmp/$APPID-prev.ipk"
  install_ipk "/tmp/$APPID-prev.ipk" || { echo "!! Vraćanje nije uspjelo:"; cat "$LOG"; return 1; }
  rm -f "/tmp/$APPID-prev.ipk"
  # the version that did not work is dropped: "previous" becomes "current"
  mv -f "$BK/previous.ipk" "$BK/current.ipk"; mv -f "$BK/previous.ver" "$BK/current.ver" 2>/dev/null || true
  relaunch
  echo "   vraćena verzija $(installed_ver)"
}
if [ "$MODE" = rollback ]; then rollback; exit $?; fi

echo "==> Preuzimam $IPK_URL"
fetch "$IPK_URL" "$IPK" || { echo "!! Preuzimanje nije uspjelo. Provjeri mrežu/DNS na TV-u (nslookup github.com)."; exit 1; }

echo "==> Instaliram"
install_ipk "$IPK" || { echo "!! Instalacija nije uspjela:"; cat "$LOG"; exit 1; }
NEW_VER=$(installed_ver)
if [ -s "$BK/current.ipk" ] && [ "$(cat "$BK/current.ver" 2>/dev/null)" != "$NEW_VER" ]; then
  mv -f "$BK/current.ipk" "$BK/previous.ipk"; mv -f "$BK/current.ver" "$BK/previous.ver" 2>/dev/null || true
fi
mv -f "$IPK" "$BK/current.ipk"
echo "$NEW_VER" > "$BK/current.ver"
echo "   verzija $NEW_VER"

# helper scripts ship inside the .ipk (raw.githubusercontent caches old copies)
get_tool() {
  for d in /media/developer/apps/usr/palm/applications/$APPID /media/cryptofs/apps/usr/palm/applications/$APPID; do
    if [ -f "$d/tools/$1" ]; then cp -f "$d/tools/$1" "$2"; return 0; fi
  done
  fetch "https://raw.githubusercontent.com/$REPO/main/scripts/$1$NOCACHE" "$2"
}

echo "==> Home guard (Home tipka otvara Dom)"
GUARD="/home/root/dom-homeguard.sh"
get_tool dom-homeguard.sh "$GUARD"
chmod +x "$GUARD"
if [ -f /tmp/dom-homeguard.pid ]; then
  kill "$(cat /tmp/dom-homeguard.pid)" 2>/dev/null || true
fi
pkill -f "dom-homeguard.sh" 2>/dev/null || true
pkill -f "getForegroundAppInfo" 2>/dev/null || true
pkill -f "getPowerState" 2>/dev/null || true
pkill -f "registerScreenSaverRequest" 2>/dev/null || true
pkill -f "getAppLifeEvents" 2>/dev/null || true
# the background helper is started again below, with the new code
[ -f /tmp/dom-agent.pid ] && kill "$(cat /tmp/dom-agent.pid)" 2>/dev/null || true
pkill -f "dom-agent.js" 2>/dev/null || true
pkill -f "getAllInputStatus" 2>/dev/null || true
rm -f /tmp/dom-agent.pid
get_tool dom-ctl.sh /home/root/dom-ctl.sh
chmod +x /home/root/dom-ctl.sh
# a copy of this installer, for "Nadogradi Dom" in Settings
get_tool install.sh /home/root/dom-install.sh.new && mv /home/root/dom-install.sh.new /home/root/dom-install.sh && chmod +x /home/root/dom-install.sh || true
if [ -f /home/root/dom-disabled ]; then
  echo "   (Dom je isključen u Postavkama — Home tipka ostaje na LG Homeu)"
else
  nohup "$GUARD" >/dev/null 2>&1 &
fi

echo "==> Pozadinski pomoćnik (mobitel, obavijesti, konzole)"
get_tool dom-agent.js /home/root/dom-agent.js
get_tool dom-web.html /home/root/dom-web.html
mkdir -p "$INITD"
printf '%s\n' '#!/bin/sh' \
  '# Dom: background helper (phone page, new-episode notices, consoles on HDMI). Undo: delete this file.' \
  '( sleep 20; /home/root/dom-ctl.sh agent start ) >/dev/null 2>&1 &' > "$INITD/91-dom-agent"
chmod +x "$INITD/91-dom-agent"
/home/root/dom-ctl.sh agent start || true

echo "==> Stremio: pomoćnik za tipke"
get_tool dom-keys.js /home/root/dom-keys.js
rm -f /home/root/dom-spotify.js /home/root/dom-spotify.json   # the short-lived "what's playing" helper
NODE=$(command -v node || ls /usr/bin/node /usr/local/bin/node 2>/dev/null | head -1)
if [ -z "$NODE" ]; then
  echo "!! Node nije pronađen; otvaranje Stremio epizoda neće raditi."
elif [ ! -s /home/root/dom-ssap-key ]; then
  echo "   >>> Na TV-u će se pojaviti upit za dozvolu — prihvati ga daljinskim (OK). <<<"
  "$NODE" /home/root/dom-keys.js pair || echo "!! Uparivanje nije uspjelo (možeš ponoviti: $NODE /home/root/dom-keys.js pair)"
fi

echo "==> Blokada firmware ažuriranja"
mkdir -p "$INITD"
cat > "$INITD/05-dom-block-update" <<'EOF'
#!/bin/sh
# Dom: block LG firmware updates so root isn't lost.
# Only bind mounts / runtime rules - nothing on the system is changed permanently.
# Undo: delete this file and reboot.
EMPTY=/home/root/.dom-empty
[ -f "$EMPTY" ] || : > "$EMPTY"
# 1) the updater binary becomes an empty file
if [ -e /usr/sbin/update ] && ! grep -q ' /usr/sbin/update ' /proc/mounts; then
  mount --bind "$EMPTY" /usr/sbin/update
fi
# 2) LG update servers resolve to localhost
if ! grep -q 'dom-block' /etc/hosts 2>/dev/null; then
  HOSTS=/home/root/.dom-hosts
  cp /etc/hosts "$HOSTS" 2>/dev/null || : > "$HOSTS"
  echo "# dom-block" >> "$HOSTS"
  for d in snu.lge.com su.lge.com su-ssl.lge.com snu-dev.lge.com su-dev.lge.com nsu.lge.com; do
    echo "127.0.0.1 $d" >> "$HOSTS"
    echo "::1 $d" >> "$HOSTS"
  done
  mount --bind "$HOSTS" /etc/hosts
fi
# 3) hardcoded update server IP
if command -v iptables >/dev/null 2>&1; then
  iptables -C OUTPUT -d 156.147.69.32 -j REJECT 2>/dev/null || iptables -I OUTPUT -d 156.147.69.32 -j REJECT 2>/dev/null
fi
exit 0
EOF
chmod +x "$INITD/05-dom-block-update"
sh "$INITD/05-dom-block-update" || true
if grep -q ' /usr/sbin/update ' /proc/mounts; then echo "   updater blokiran"; else echo "!! updater nije blokiran"; fi
if grep -q 'dom-block' /etc/hosts 2>/dev/null; then echo "   LG update serveri blokirani"; else echo "!! hosts blokada nije uspjela"; fi

echo "==> Bez bljeska LG Homea"
get_tool dom-blank-home.sh /home/root/dom-blank-home.sh
chmod +x /home/root/dom-blank-home.sh
cat > "$INITD/06-dom-blank-home" <<'EOF'
#!/bin/sh
/home/root/dom-blank-home.sh on
EOF
chmod +x "$INITD/06-dom-blank-home"
/home/root/dom-blank-home.sh on || true
# make sure LG Home still starts with its widget page hidden (falls back by itself if it does not)
if [ ! -f /home/root/dom-disabled ]; then echo "   $(/home/root/dom-blank-home.sh check 2>/dev/null)"; fi

echo "==> Čišćenje i ubrzanje"
get_tool dom-tune.sh /home/root/dom-tune.sh
chmod +x /home/root/dom-tune.sh
cat > "$INITD/07-dom-tune" <<'EOF'
#!/bin/sh
# Dom: debloat + speed, applied 90 s after boot (runtime only).
# Undo: delete this file and restart the TV.
[ -x /home/root/dom-tune.sh ] || exit 0
( sleep 90; /home/root/dom-tune.sh boot ) >/dev/null 2>&1 &
EOF
chmod +x "$INITD/07-dom-tune"
MEM0=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
/home/root/dom-tune.sh apply >/dev/null 2>&1 </dev/null || true
sleep 3
echo "   slobodno memorije: $MEM0 MB -> $(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo) MB"
echo "   $(/home/root/dom-tune.sh get 2>/dev/null)"

echo "==> Autostart pri paljenju TV-a"
mkdir -p "$INITD"
cat > "$INITD/90-dom-launcher" <<EOF
#!/bin/sh
# Dom: home guard + pokretanje nakon paljenja TV-a
[ -f /home/root/dom-disabled ] && exit 0
nohup $GUARD >/dev/null 2>&1 &
(
  sleep 15
  luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"$APPID"}' >/dev/null 2>&1
) &
EOF
chmod +x "$INITD/90-dom-launcher"

echo "==> Pokrećem Dom"
relaunch
# a new version that does not start (no sign of life in 45 s) is undone at once
if [ -s "$BK/previous.ipk" ] && [ -z "$DOM_NO_CHECK" ]; then
  i=0
  while [ $i -lt 45 ] && [ ! -f /tmp/dom-alive ]; do sleep 1; i=$((i + 1)); done
  if [ -f /tmp/dom-alive ]; then
    echo "   Dom $NEW_VER radi"
  else
    echo "!! Dom $NEW_VER se ne pokreće, vraćam prethodnu verziju"
    if rollback; then installed_ver > /home/root/dom-rolled-back; fi
  fi
fi

echo
echo "Gotovo. Home tipka sada otvara Dom (keybind u LG Input Hooku možeš maknuti)."
