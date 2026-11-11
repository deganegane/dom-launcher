#!/bin/sh
# Dom tune: debloat + speed for a rooted LG webOS TV.
# Runtime only: stops services, adds hosts entries, lowers logging. Nothing on the
# system partition changes - `dom-tune.sh off` or a restart puts everything back.
#
#   dom-tune.sh get              one line of state (for Dom's Settings)
#   dom-tune.sh set <group> 0|1  switch a group and apply it right away
#   dom-tune.sh apply            apply every group that is switched on
#   dom-tune.sh off              undo everything now (switches are kept)
#   dom-tune.sh boot             used by the init.d hook (with a crash guard)
#   dom-tune.sh status           readable report
CONF=/home/root/dom-tune.conf
STOPPED=/tmp/dom-tune.stopped
HOSTS=/home/root/.dom-hosts
SAFE=/home/root/dom-tune-safe
PENDING=/home/root/.dom-tune-pending
LOG=/tmp/dom-tune.log
GRPS="track logs voice iot cast tv"

# systemd units per group (stopped, never disabled)
U_track="rdxd uploadd remotelogger contentminer nudge"
U_logs=""
U_voice="voiceinput voiceconductor"
U_iot="com.webos.service.otbr com.webos.service.zigbeeadapter google-home-controller com.webos.service.ruleengine com.webos.service.pushclient"
U_cast="airplay-adaptor appcasting miracast chromecast-provisioning dmr"
U_tv="iepg tv-reservation-agent broadcast-conf-downloader"
# on-demand services per group (just ended; the system may start them again when asked)
K_track="admanager"
K_iot="iot-client"

log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }
default() { case "$1" in track|logs) echo 1 ;; *) echo 0 ;; esac; }
cfg() {
  v=$(sed -n "s/^$1=\([01]\)$/\1/p" "$CONF" 2>/dev/null | tail -1)
  [ -n "$v" ] && echo "$v" || default "$1"
}
cfg_set() {
  touch "$CONF"
  grep -v "^$1=" "$CONF" > "$CONF.new" 2>/dev/null
  echo "$1=$2" >> "$CONF.new"
  mv "$CONF.new" "$CONF"
}
is_group() { case " $GRPS " in *" $1 "*) return 0 ;; esac; return 1; }
mem() { awk -v k="$1" '$1 == k":" { printf "%d", $2 / 1024 }' /proc/meminfo; }
tmo() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }

# ---------- services ----------
stop_unit() {
  u="$1.service"
  systemctl is-active --quiet "$u" 2>/dev/null || return 0
  # never pull down anything another unit hard-depends on
  dep=$(systemctl show "$u" -p RequiredBy -p BoundBy 2>/dev/null | sed 's/^[A-Za-z]*=//' | tr '\n' ' ' | sed 's/^ *//;s/ *$//')
  if [ -n "$dep" ]; then log "skip $u (needed by: $dep)"; return 0; fi
  if tmo 10 systemctl stop "$u" 2>/dev/null; then
    grep -qx "$u" "$STOPPED" 2>/dev/null || echo "$u" >> "$STOPPED"
    log "stopped $u"
  else
    log "could not stop $u"
  fi
}
start_unit() {
  u="$1.service"
  grep -qx "$u" "$STOPPED" 2>/dev/null || return 0
  systemctl --no-block start "$u" 2>/dev/null
  grep -vx "$u" "$STOPPED" > "$STOPPED.new" 2>/dev/null; mv "$STOPPED.new" "$STOPPED"
  log "started $u"
}
end_proc() {
  for p in $(pidof "$1" 2>/dev/null); do kill "$p" 2>/dev/null && log "ended $1 ($p)"; done
}

# ---------- hosts ----------
hosts_ensure() {
  grep -q 'dom-block' /etc/hosts 2>/dev/null && return 0
  grep -q ' /etc/hosts ' /proc/mounts 2>/dev/null && grep -q 'dom-block' "$HOSTS" 2>/dev/null && return 0
  cp /etc/hosts "$HOSTS" 2>/dev/null || : > "$HOSTS"
  echo "# dom-block" >> "$HOSTS"
  mount --bind "$HOSTS" /etc/hosts 2>/dev/null
}
hosts_add() {
  tag=$1; shift
  hosts_ensure
  grep -q "# dom-$tag-begin" "$HOSTS" 2>/dev/null && return 0
  {
    echo "# dom-$tag-begin"
    for d in "$@"; do echo "0.0.0.0 $d"; echo ":: $d"; done
    echo "# dom-$tag-end"
  } >> "$HOSTS"
  log "hosts +$tag ($# names)"
}
hosts_del() {
  grep -q "# dom-$1-begin" "$HOSTS" 2>/dev/null || return 0
  # rewrite in place: /etc/hosts is a bind mount of this very file
  sed "/# dom-$1-begin/,/# dom-$1-end/d" "$HOSTS" > /tmp/dom-hosts.new && cat /tmp/dom-hosts.new > "$HOSTS"
  rm -f /tmp/dom-hosts.new
  log "hosts -$1"
}
country() {
  luna-send -n 1 -w 3000 luna://com.webos.settingsservice/getSystemSettings \
    '{"category":"option","keys":["smartServiceCountryCode2"]}' 2>/dev/null \
    | sed -n 's/.*"smartServiceCountryCode2" *: *"\([A-Za-z]*\)".*/\1/p' | tr 'A-Z' 'a-z'
}
track_domains() {
  for p in "" $(country) eu us kr gb de; do
    for d in ad.lgsmartad.com info.lgsmartad.com rdx2.lgtvsdp.com ibs.lgappstv.com; do
      echo "${p:+$p.}$d"
    done
  done | sort -u
  for d in lgsmartad.com ad.lgappstv.com lgad.cjpowercast.com lgad.cjpowercast.com.edgesuite.net \
           ngfts.lge.com alphonso.tv api.alphonso.tv lgads.tv; do echo "$d"; done
}

# ---------- groups ----------
apply_group() {
  g=$1
  eval "units=\$U_$g; procs=\$K_$g"
  for x in $units; do stop_unit "$x"; done
  for x in $procs; do end_proc "$x"; done
  case "$g" in
    track) hosts_add track $(track_domains) ;;
    iot)   hosts_add iot api.lgtviot.com lgtviot.com ;;
    logs)  command -v PmLogCtl >/dev/null 2>&1 && PmLogCtl set '*' err >/dev/null 2>&1 && log "logging -> err" ;;
  esac
}
undo_group() {
  g=$1
  eval "units=\$U_$g"
  for x in $units; do start_unit "$x"; done
  case "$g" in
    track) hosts_del track ;;
    iot)   hosts_del iot ;;
    logs)  log "logging level returns after a restart" ;;
  esac
}
apply_all() { for g in $GRPS; do [ "$(cfg "$g")" = 1 ] && apply_group "$g"; done; }
state() {
  out=""
  for g in $GRPS; do out="$out$g=$(cfg "$g") "; done
  safe=0; [ -f "$SAFE" ] && safe=1
  n=0; [ -f "$STOPPED" ] && n=$(grep -c . "$STOPPED")
  echo "${out}mem=$(mem MemAvailable) swap=$(mem SwapFree) stopped=$n safe=$safe"
}

case "$1" in
  get) state ;;
  set)
    is_group "$2" || { echo "unknown group: $2"; exit 1; }
    case "$3" in 0|1) ;; *) echo "value must be 0 or 1"; exit 1 ;; esac
    cfg_set "$2" "$3"
    rm -f "$SAFE" "$PENDING"
    if [ "$3" = 1 ]; then apply_group "$2"; else undo_group "$2"; fi
    sleep 1
    state
    ;;
  apply) rm -f "$SAFE" "$PENDING"; apply_all; sleep 1; state ;;
  off) for g in $GRPS; do undo_group "$g"; done; state ;;
  boot)
    [ -f "$SAFE" ] && exit 0
    # a restart that came within 10 minutes of applying counts as a strike; two strikes = stay off
    n=0
    if [ -f "$PENDING" ]; then
      n=$(($(cat "$PENDING" 2>/dev/null || echo 0) + 1))
      if [ "$n" -ge 2 ]; then touch "$SAFE"; rm -f "$PENDING"; log "two short boots in a row: safe mode"; exit 0; fi
    fi
    echo "$n" > "$PENDING"
    apply_all
    ( sleep 600; rm -f "$PENDING" ) >/dev/null 2>&1 &
    ;;
  status)
    echo "== Dom tune"
    state
    echo "RAM: $(mem MemTotal) MB ukupno, $(mem MemAvailable) MB slobodno | swap: $(mem SwapTotal) MB, $(mem SwapFree) MB slobodno"
    [ -f "$SAFE" ] && echo "!! sigurnosni način: ništa se ne primjenjuje dok ne uključiš neku grupu"
    echo; echo "== ugašeno"
    cat "$STOPPED" 2>/dev/null | tr '\n' ' '; echo
    echo; echo "== hosts"
    echo "blokiranih imena: $(grep -c '^0\.0\.0\.0 \|^127\.0\.0\.1 ' /etc/hosts 2>/dev/null)"
    echo; echo "== swap"
    cat /proc/swaps 2>/dev/null
    echo "swappiness: $(cat /proc/sys/vm/swappiness 2>/dev/null)  zram: $(ls /sys/block 2>/dev/null | grep -c zram)"
    echo; echo "== procesi kandidati (kB RAM, kB swap, ime, cgroup)"
    CAND=" sdx update admanager iot-client trigger_thinq trigger_alexa nlpmanager voiceclick voiceinput_preprocessor iconnectivity hybridtv-manager legacy-broadcast-dvb awareness-agent user-intent-manager lg.thinqai.adapter wowplay contentminer sportsalarm ai-inference-manager nn-proxy telnetd "
    for d in /proc/[0-9]*; do
      read -r n < "$d/comm" 2>/dev/null || continue
      [ ${#n} -ge 3 ] || continue
      case "$CAND" in *" $n"*) ;; *) continue ;; esac
      echo "$(awk '/VmRSS/{r=$2} /VmSwap/{s=$2} END{print r+0, s+0}' "$d/status" 2>/dev/null) $n $(sed -n 's/.*\///p' "$d/cgroup" 2>/dev/null | head -1) exe=$(readlink "$d/exe" 2>/dev/null)"
    done
    echo; echo "== postavke (privatnost)"
    for c in option general other; do
      luna-send -n 1 -w 3000 luna://com.webos.settingsservice/getSystemSettings "{\"category\":\"$c\"}" 2>/dev/null \
        | tr ',' '\n' | grep -iE 'live|acr|adver|adId|track|promo|recommend|voice|thinq|consent|privacy|country' | tr -d ' ' | sed "s/^/$c: /" | head -30
    done
    echo; echo "== zadnji zapisi"
    tail -25 "$LOG" 2>/dev/null
    ;;
  *) sed -n '2,13p' "$0" ;;
esac
exit 0
