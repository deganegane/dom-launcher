#!/bin/sh
# Dom: read-only snapshot of what runs on the TV, to plan a safe debloat.
# Changes nothing. Output is also saved to /tmp/dom-probe.txt
OUT=/tmp/dom-probe.txt
main() {

echo "== sustav"
cat /var/run/nyx/os_info.json 2>/dev/null | grep -E '"(webos_release|webos_name|core_os_release)"' | tr -d ' ,'
uptime
grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo | tr -s ' '
command -v systemctl >/dev/null && echo "init: systemd" || echo "init: upstart/other"

echo; echo "== CPU/GPU takt"
grep -c ^processor /proc/cpuinfo
for c in /sys/devices/system/cpu/cpu[0-9]*/cpufreq; do
  [ -d "$c" ] && echo "$(basename $(dirname $c)): $(cat $c/scaling_governor) $(cat $c/scaling_cur_freq)/$(cat $c/cpuinfo_max_freq) [$(cat $c/scaling_available_governors 2>/dev/null)]"
done | sort -u -k2
for g in /sys/class/devfreq/*; do [ -d "$g" ] && echo "$(basename $g): $(cat $g/governor 2>/dev/null) $(cat $g/cur_freq 2>/dev/null)/$(cat $g/max_freq 2>/dev/null)"; done
cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | tr '\n' ' '; echo
echo "CPU opterećenje (5 s):"; head -1 /proc/stat > /tmp/s1; sleep 5; head -1 /proc/stat > /tmp/s2
awk 'NR==1{for(i=2;i<=NF;i++)a+=$i; ia=$5} NR==2{for(i=2;i<=NF;i++)b+=$i; ib=$5} END{printf "%.0f%% zauzeto\n", 100*(1-(ib-ia)/(b-a))}' /tmp/s1 /tmp/s2
echo "pmlog razina: $(cat /etc/pmlog.d/*.conf 2>/dev/null | grep -i level | head -3 | tr '\n' ' ')"

echo; echo "== top 40 procesa po RAM-u (kB name)"
for d in /proc/[0-9]*; do
  r=$(awk '/VmRSS/{print $2}' "$d/status" 2>/dev/null)
  [ -n "$r" ] || continue
  n=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null | cut -c1-90)
  [ -n "$n" ] || n="[$(awk '/Name/{print $2}' "$d/status")]"
  echo "$r $n"
done | sort -rn | head -40

echo; echo "== svi procesi (imena)"
for d in /proc/[0-9]*; do awk '/^Name/{print $2}' "$d/status" 2>/dev/null; done | sort | uniq -c | sort -rn | awk '{printf "%s(%s) ", $2, $1} END {print ""}'

if command -v systemctl >/dev/null; then
  echo; echo "== systemd servisi koji rade"
  systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1}' | tr '\n' ' '; echo
fi

echo; echo "== vanjske TCP veze (proces -> IP:port)"
(netstat -tnp 2>/dev/null || ss -tnp 2>/dev/null) | grep ESTAB | awk '{print $NF, $5}' \
  | grep -vE ' (127\.|::1|::ffff:127\.|192\.168\.|::ffff:192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | sort | uniq -c | head -40

echo; echo "== DNS pokušaji (30 s osluškivanja, ako postoji tcpdump)"
if command -v tcpdump >/dev/null; then
  timeout 30 tcpdump -nl -i any udp port 53 2>/dev/null | grep -oE '[A-Z]+\? [^ ]+' | awk '{print $2}' | sort | uniq -c | sort -rn | head -40
else
  echo "nema tcpdumpa"
fi

echo; echo "== postavke privatnosti/reklama"
for c in general network option commercial aiservice; do
  luna-send -n 1 -f luna://com.webos.settingsservice/getSystemSettings "{\"category\":\"$c\"}" 2>/dev/null \
    | grep -iE '"[^"]*(live|acr|plus|adver|tracking|promo|recommend|homeAd|smartad|ai[A-Z]|voice|thinq|iot|consent|privacy)[^"]*" *:' \
    | sed "s/^ */$c: /"
done

echo; echo "== Homebrew zastavice i init.d"
ls /var/luna/preferences/ 2>/dev/null | grep -i webosbrew
ls /var/lib/webosbrew/init.d/ 2>/dev/null | tr '\n' ' '; echo
echo "hosts linija: $(wc -l < /etc/hosts)"
grep -c 'telemetry\|dom-block' /etc/hosts

echo; echo "== sistemske aplikacije"
ls /usr/palm/applications/ 2>/dev/null | tr '\n' ' '; echo

echo; echo "== sistemski servisi (/usr/palm/services, imena)"
ls /usr/palm/services/ 2>/dev/null | tr '\n' ' '; echo

}
main 2>&1 | tee "$OUT"
echo
echo "-- gotovo, spremljeno u $OUT"
