/* Dom — Apple TV style launcher for rooted LG webOS TVs */
(function () {
  'use strict';

  var APP_ID = 'com.deganegane.dom';
  var HB_EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
  var AM = 'luna://com.webos.applicationManager';
  var STREMIO_API = 'https://api.strem.io/api/';
  var DEMO = typeof window.PalmServiceBridge === 'undefined';
  // layouts: classic = 5-column grid; the others put apps in one row (a dock)
  // classic = 5-column grid; the others change both the look and how the remote moves
  var LAYOUTS = {
    classic:  { name: 'Klasično' },
    sidebar:  { name: 'Bočni izbornik', mode: 'list', enter: 'right', cardAxis: 'grid3', listView: 780 },
    bento:    { name: 'Bento', mode: 'dock', scale: 0.873, view: 1938, enter: 'up', cardAxis: 'v', fallback: true },
    carousel: { name: 'Karusel', mode: 'carousel', enter: 'down', cardAxis: 'h', cardView: 1692, maxCards: 6 },
    ambient:  { name: 'Ambijent', mode: 'dock', scale: 0.8, view: 1965, enter: 'up', cardAxis: 'h', cardView: 1692 },
    traka:    { name: 'Traka', mode: 'dock', scale: 0.72, view: 2440, enter: 'down', cardAxis: 'h', cardView: 1728, tabs: true },
    konzola:  { name: 'Konzola', mode: 'dock', scale: 0.49, view: 2120, step: 226, enter: 'down', cardAxis: 'h', cardView: 1728 },
    harmonika: { name: 'Harmonika', mode: 'accordion', enter: 'down', cardAxis: 'h', cardView: 1728, boxed: true }
  };
  LAYOUTS.bento.boxed = true;
  var LAYOUT_ORDER = ['classic', 'sidebar', 'bento', 'carousel', 'ambient', 'traka', 'konzola', 'harmonika'];
  function L() { return LAYOUTS[S.layout] || LAYOUTS.classic; }
  function cols() { var m = L().mode; return m === 'list' ? 1 : (m ? Math.max(1, S.list.length) : 5); }
  var ROW_H = 180 + 92;
  var SETTINGS_KEY = '__settings';
  var RENAME = { 'YouTube AdFree': 'YouTube', 'PS5 Game Console': 'PlayStation' };   // shown name instead of the app's own
  function shownName(t) {
    if (RENAME[t]) return RENAME[t];
    if (/^youtube\s*ad[\s-]*free$/i.test(t || '')) return 'YouTube';
    if (/^(ps\s?[45]|playstation(\s?[45])?)(\s+game)?(\s+console)?$/i.test(t || '')) return 'PlayStation';
    var m = /^(.{3,}?)\s+[-\u2013\u2014|:]\s+\S/.exec(t || '');   // "Name - what it does" -> "Name"
    return m && (t || '').length > 18 ? m[1] : t;
  }

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, BKSP: 8, ESC: 27 };

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('dom.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('dom.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ================= luna / shell ================= */
  var bridges = [];
  function lunaDirect(uri, params, timeout) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var b = new window.PalmServiceBridge();
      bridges.push(b);
      function finish() { done = true; var i = bridges.indexOf(b); if (i >= 0) bridges.splice(i, 1); }
      var t = setTimeout(function () { if (!done) { finish(); reject(new Error('Timeout: ' + uri)); } }, timeout || 5000);
      b.onservicecallback = function (msg) {
        if (done) return;
        clearTimeout(t); finish();
        try { b.cancel(); } catch (e2) {}
        var r; try { r = JSON.parse(msg); } catch (e) { return reject(e); }
        if (r.returnValue === false) reject(new Error(r.errorText || ('Greška: ' + uri)));
        else resolve(r);
      };
      b.call(uri, JSON.stringify(params || {}));
    });
  }
  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function exec(cmd, timeout) {
    return lunaDirect(HB_EXEC, { command: cmd }, timeout || 20000).then(function (r) {
      if (typeof r.stdoutString === 'string') return r.stdoutString;
      if (r.stdoutBytes) { try { return atob(r.stdoutBytes); } catch (e) {} }
      return '';
    });
  }
  // Try the call directly; if the sandbox denies it, run it as root through Homebrew Channel.
  var needsRoot = {};   // calls the sandbox denied once go straight to the root shell next time
  function luna(uri, params) {
    if (DEMO) return Promise.reject(new Error('demo'));
    var viaRoot = function () {
      return exec('luna-send -n 1 -w 8000 ' + uri + ' ' + shq(JSON.stringify(params || {}))).then(function (out) {
        var r = JSON.parse(out.trim());
        if (r.returnValue === false) throw new Error(r.errorText || 'Greška');
        return r;
      });
    };
    if (needsRoot[uri]) return viaRoot();
    return lunaDirect(uri, params).catch(function () { needsRoot[uri] = true; return viaRoot(); });
  }
  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .catch(function (err) {
        if (DEMO) throw err;
        return exec('curl -s -m 20 -X POST -H ' + shq('content-type: application/json') +
          ' --data ' + shq(JSON.stringify(body)) + ' ' + shq(url)).then(function (out) { return JSON.parse(out); });
      });
  }

  /* ================= state ================= */
  var S = {
    apps: [],                 // all launch points
    list: [],                 // visible tiles, in order (+ settings tile)
    order: store.get('order', []),
    hidden: store.get('hidden', []),
    cw: store.get('cw', []),  // stremio continue watching
    layout: store.get('layout', 'classic'),
    authKey: store.get('authKey', ''),
    stremioUser: store.get('stremioUser', ''),
    zone: 'grid',             // grid | shelf | tabs | settings
    idx: 0, card: 0, tab: 0, moving: false,
    wall: store.get('wall', null) || { on: false, src: 'bing', mins: 5, paused: false },
    lastStremio: 0
  };
  if (DEMO && !S.authKey) S.cw = demoCW();

  var stage = $('#stage');

  /* ================= apps ================= */
  function fileUrl(p) {
    if (!p) return '';
    if (/^(https?|file|data):/.test(p)) return p;
    if (p.charAt(0) === '/') return 'file://' + p;
    return p;
  }
  function loadApps() {
    if (DEMO) return Promise.resolve(demoApps());
    return luna(AM + '/listLaunchPoints', {}).then(function (r) {
      return (r.launchPoints || []).filter(function (lp) {
        return lp.id !== APP_ID && lp.id !== 'com.webos.app.home';
      }).map(function (lp) {
        return {
          key: lp.launchPointId || lp.id,
          id: lp.id,
          title: shownName(lp.title) || lp.id,
          title0: lp.title || lp.id,   // custom icons and backgrounds are still found by the original name
          iconPath: lp.extraLargeIcon || lp.largeIcon || lp.mediumLargeIcon || lp.icon || '',
          bgPath: lp.bgImage || '',
          icon: '',
          color: lp.iconColor || lp.bgColor || '',
          bg: '',
          params: lp.params || {}
        };
      });
    }).then(cacheAssets);
  }

  // The web sandbox can't read other apps' folders (Store apps live in root-only cryptofs),
  // so copy icons/backgrounds into our own app folder as root, then load them by relative path.
  function cacheAssets(apps) {
    var appDir = decodeURIComponent(location.pathname).replace(/\/[^\/]*$/, '');
    var cmds = ['D=' + shq(appDir + '/cache'), 'mkdir -p "$D"'];
    function plan(app, field, src, suffix) {
      if (!src) return;
      if (/^https?:|^data:/.test(src)) { app[field] = src; return; }
      src = src.replace(/^file:\/\//, '');
      var ext = (/\.(png|jpe?g|webp|gif)$/i.exec(src) || ['', 'png'])[1].toLowerCase();
      var name = (app.key + suffix).replace(/[^A-Za-z0-9._-]/g, '_') + '.' + ext;
      cmds.push('[ "$D/' + name + '" -nt ' + shq(src) + ' ] || cp -f ' + shq(src) + ' "$D/' + name + '" 2>/dev/null');
      app[field] = 'cache/' + name;
      app[field + 'Direct'] = 'file://' + src;
    }
    apps.forEach(function (a) { plan(a, 'icon', a.iconPath, ''); plan(a, 'bg', a.bgPath, '_bg'); });
    // own pictures: /home/root/dom-backgrounds/<app id or title>.jpg|png
    cmds.push('B=/home/root/dom-backgrounds');
    apps.forEach(function (a) {
      var base = a.key.replace(/[^A-Za-z0-9._-]/g, '_') + '_custom';
      var names = [a.id, a.title0, a.title].filter(function (n, i, all) { return n && all.indexOf(n) === i; }).map(shq).join(' ');
      cmds.push('for n in ' + names + '; do for e in jpg jpeg png webp; do if [ -f "$B/$n.$e" ]; then cp -f "$B/$n.$e" "$D/' + base + '.$e" && echo "CUSTOM|' + a.key.replace(/[|'"\\$`]/g, '') + '|' + base + '.$e"; break 2; fi; done; done');
    });
    // own icons: /home/root/dom-icons/<app id or title>.png|jpg|webp
    cmds.push('I=/home/root/dom-icons');
    apps.forEach(function (a) {
      var base = a.key.replace(/[^A-Za-z0-9._-]/g, '_') + '_icon';
      var names = [a.id, a.title0, a.title].filter(function (n, i, all) { return n && all.indexOf(n) === i; }).map(shq).join(' ');
      cmds.push('for n in ' + names + '; do for e in png jpg jpeg webp; do if [ -f "$I/$n.$e" ]; then cp -f "$I/$n.$e" "$D/' + base + '.$e" && echo "ICON|' + a.key.replace(/[|'"\\$`]/g, '') + '|' + base + '.$e|$(date -r "$I/$n.$e" +%s)"; break 2; fi; done; done');
    });
    // last frame of what was watched in each app, captured by dom-homeguard.sh
    cmds.push('H=/home/root/dom-shots');
    apps.forEach(function (a) {
      if (!/^[A-Za-z0-9._-]+$/.test(a.id)) return;
      var name = a.key.replace(/[^A-Za-z0-9._-]/g, '_') + '_shot.jpg';
      cmds.push('if [ -f "$H/' + a.id + '.jpg" ]; then [ "$D/' + name + '" -nt "$H/' + a.id + '.jpg" ] || cp -f "$H/' + a.id + '.jpg" "$D/' + name +
        '"; echo "SHOT|' + a.key.replace(/[|'"\\$`]/g, '') + '|' + name + '|$(date -r "$H/' + a.id + '.jpg" +%s)"; fi');
    });
    cmds.push('[ -f /home/root/dom-disabled ] && echo DISABLED');
    cmds.push('echo ok');
    return exec(cmds.join('; '), 30000).then(function (out) {
      S.disabled = /^DISABLED$/m.test(out || '');
      var byKey = {};
      apps.forEach(function (a) { byKey[a.key.replace(/[|'"\\$`]/g, '')] = a; });
      (out || '').split('\n').forEach(function (line) {
        var m = /^CUSTOM\|(.*)\|(.*)$/.exec(line.trim());
        if (m && byKey[m[1]]) { byKey[m[1]].bg = 'cache/' + m[2]; byKey[m[1]].custom = true; }
        var ic = /^ICON\|(.*)\|(.*)\|(\d*)$/.exec(line.trim());
        if (ic && byKey[ic[1]]) { byKey[ic[1]].customIcon = 'cache/' + ic[2] + '?t=' + ic[3]; }
        var sh = /^SHOT\|(.*)\|(.*)\|(\d*)$/.exec(line.trim());
        if (sh && byKey[sh[1]]) byKey[sh[1]].shot = 'cache/' + sh[2] + '?t=' + sh[3];
      });
      apps.forEach(function (a) { if (a.customIcon) { a.fallbackIcon = a.icon; a.icon = a.customIcon; a.iconDirect = ''; } });
      return apps;
    }).catch(function () {
      // no root service: fall back to direct paths (works for system apps on some firmwares)
      apps.forEach(function (a) { a.icon = a.iconDirect || a.icon; a.bg = a.bgDirect || a.bg; });
      return apps;
    });
  }
  function isStremio(a) { return a && (/stremio/i.test(a.id) || /stremio/i.test(a.title)); }
  function stremioApp() { for (var i = 0; i < S.apps.length; i++) if (isStremio(S.apps[i])) return S.apps[i]; return null; }

  function buildList() {
    var byKey = {};
    S.apps.forEach(function (a) { byKey[a.key] = a; });
    var out = [];
    S.order.forEach(function (k) { if (byKey[k]) { out.push(byKey[k]); delete byKey[k]; } });
    // new apps: Stremio first, then the TV's own order
    var rest = S.apps.filter(function (a) { return byKey[a.key]; });
    rest.sort(function (a, b) { return (isStremio(b) ? 1 : 0) - (isStremio(a) ? 1 : 0); });
    out = out.concat(rest).filter(function (a) { return S.hidden.indexOf(a.key) < 0; });
    out.push({ key: SETTINGS_KEY, title: 'Postavke' });
    S.list = out;
    if (S.idx >= S.list.length) S.idx = S.list.length - 1;
  }
  function saveOrder() {
    var visibleKeys = S.list.filter(function (a) { return a.key !== SETTINGS_KEY; }).map(function (a) { return a.key; });
    var hiddenKeys = S.order.filter(function (k) { return visibleKeys.indexOf(k) < 0; });
    S.order = visibleKeys.concat(hiddenKeys);
    store.set('order', S.order);
  }

  function launch(app, extraParams) {
    if (!app) return;
    if (DEMO) { toast('Pokrećem: ' + app.title); return; }
    var params = {};
    var k;
    for (k in app.params) params[k] = app.params[k];
    if (extraParams) for (k in extraParams) params[k] = extraParams[k];
    leaving();
    luna(AM + '/launch', { id: app.id, params: params }).catch(function (e) { fadeIn(true); toast('Ne mogu pokrenuti ' + app.title + ': ' + e.message); });
  }

  /* ================= stremio ================= */
  function imdbOf(id) { var m = /^(tt\d+)/.exec(id || ''); return m ? m[1] : ''; }
  function mapItem(it) {
    var st = it.state || {};
    var imdb = imdbOf(it._id);
    var season = 0, episode = 0;
    var vm = /:(\d+):(\d+)$/.exec(st.video_id || '');
    if (vm) { season = +vm[1]; episode = +vm[2]; }
    return {
      id: it._id, type: it.type, name: it.name, poster: it.poster || '',
      videoId: st.video_id || '', season: season, episode: episode,
      offset: st.timeOffset || 0, duration: st.duration || 0,
      backdrop: imdb ? 'https://images.metahub.space/background/large/' + imdb + '/img' : (it.poster || ''),
      thumb: imdb ? (season ? 'https://episodes.metahub.space/' + imdb + '/' + season + '/' + episode + '/w780.jpg'
                            : 'https://images.metahub.space/background/medium/' + imdb + '/img') : (it.poster || ''),
      thumbFallback: imdb ? 'https://images.metahub.space/background/medium/' + imdb + '/img' : (it.poster || ''),
      logo: imdb ? 'https://images.metahub.space/logo/medium/' + imdb + '/img' : ''
    };
  }
  // Same rules as Stremio's own Continue Watching row (stremio-core
  // continue_watching_preview): items with progress OR a new-episode
  // notification, newest first by notification release date, else by _mtime.
  var CINEMETA = 'https://v3-cinemeta.strem.io/meta/';
  var metaCache = store.get('metaCache', {});
  function getJSON(u) {
    return fetch(u).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .catch(function (err) {
        if (DEMO) throw err;
        return exec('curl -s -m 15 ' + shq(u)).then(function (out) { return JSON.parse(out); });
      });
  }
  function seriesVideos(id) {
    var c = metaCache[id];
    if (c && Date.now() - c.t < 6 * 3600 * 1000) return Promise.resolve(c.v);
    return getJSON(CINEMETA + 'series/' + id + '.json').then(function (r) {
      var v = ((r.meta && r.meta.videos) || []).filter(function (x) { return x.released && x.season > 0; })
        .map(function (x) { return { id: x.id, s: x.season, e: x.episode || x.number, r: Date.parse(x.released) }; })
        .sort(function (a, b) { return b.r - a.r; }).slice(0, 40);
      metaCache[id] = { t: Date.now(), v: v };
      store.set('metaCache', metaCache);
      return v;
    }).catch(function () { return []; });
  }
  function buildContinueWatching(all) {
    var now = Date.now();
    var lib = all.filter(function (it) { return it.type !== 'other' && it.state && !/^yt_id|^live/.test(it._id); });
    var inCW = function (it) { return (!it.removed || it.temp) && it.state.timeOffset > 0; };
    // series that may have a new episode since last watched
    var notifCands = lib.filter(function (it) {
      return it.type === 'series' && !it.removed && !it.temp && !it.state.noNotif && /^tt\d+$/.test(it._id) && it.state.lastWatched;
    }).sort(function (a, b) { return Date.parse(b._mtime || 0) - Date.parse(a._mtime || 0); }).slice(0, 20);
    return Promise.all(notifCands.map(function (it) {
      var since = Date.parse(it.state.lastWatched);
      return seriesVideos(it._id).then(function (videos) {
        var fresh = videos.filter(function (v) { return v.r > since && v.r <= now; });
        if (!fresh.length) return null;
        fresh.sort(function (a, b) { return b.r - a.r; });
        return { id: it._id, newest: fresh[0] };
      });
    })).then(function (res) {
      // drop cached metadata of series that are no longer candidates
      var keep = {}; notifCands.forEach(function (it) { keep[it._id] = 1; });
      Object.keys(metaCache).forEach(function (k) { if (!keep[k]) delete metaCache[k]; });
      var notif = {};
      res.forEach(function (n) { if (n) notif[n.id] = n.newest; });
      var list = lib.filter(function (it) { return inCW(it) || notif[it._id]; }).map(function (it) {
        var n = notif[it._id];
        var item = mapItem(it);
        item.sortTime = n ? n.r : Date.parse(it._mtime || 0);
        if (n && !(it.state.timeOffset > 0)) {
          // no progress: show the new episode
          item.isNew = true; item.season = n.s; item.episode = n.e; item.videoId = n.id;
          var imdb = imdbOf(it._id);
          item.thumb = 'https://episodes.metahub.space/' + imdb + '/' + n.s + '/' + n.e + '/w780.jpg';
        }
        return item;
      });
      list.sort(function (a, b) { return b.sortTime - a.sortTime; });
      return list.slice(0, 10);
    });
  }

  // fetch all artwork up front so moving between cards is instant
  var preloaded = {};
  function preloadCW(items) {
    items.forEach(function (it) {
      [it.backdrop, it.logo, it.thumb].forEach(function (u) {
        if (!u || preloaded[u]) return;
        var im = new Image(); im.src = u; preloaded[u] = im;
      });
    });
  }

  /* ---------- real backdrops for cards that apps publish (those only carry a small picture) ---------- */
  var hdArt = store.get('hdArt', {});   // normalised title -> imdb id, or the time of a lookup that found nothing
  var hdBusy = {};
  function normTitle(t) { return String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function hdUrl(name) {
    var v = hdArt[normTitle(name)];
    return typeof v === 'string' && v ? 'https://images.metahub.space/background/large/' + v + '/img' : '';
  }
  function hdLookup(name) {
    var k = normTitle(name), v = hdArt[k];
    if (!k) return Promise.resolve('');
    if (typeof v === 'string') return Promise.resolve(v);
    if (typeof v === 'number' && Date.now() - v < 7 * 24 * 3600 * 1000) return Promise.resolve('');   // looked recently, nothing there
    if (hdBusy[k]) return hdBusy[k];
    var q = function (type) {
      return getJSON('https://v3-cinemeta.strem.io/catalog/' + type + '/top/search=' + encodeURIComponent(name) + '.json')
        .then(function (r) { return (r && r.metas) || []; }, function () { return null; });
    };
    hdBusy[k] = Promise.all([q('series'), q('movie')]).then(function (rs) {
      delete hdBusy[k];
      if (rs[0] === null && rs[1] === null) return '';   // offline: do not remember this as a miss
      // only an exact title counts; between a series and a film of the same name, the newer one
      var best = null;
      rs.forEach(function (list) {
        (list || []).some(function (m) {
          if (normTitle(m.name) !== k || !/^tt\d+$/.test(m.id || '')) return false;
          var y = parseInt(String(m.releaseInfo || m.year || '').slice(0, 4), 10) || 0;
          if (!best || y > best.y) best = { id: m.id, y: y };
          return true;
        });
      });
      if (Object.keys(hdArt).length > 400) hdArt = {};
      hdArt[k] = best ? best.id : Date.now();
      store.set('hdArt', hdArt);
      return best ? best.id : '';
    });
    return hdBusy[k];
  }
  function hdWarm(items) {   // one after another, so a fresh row does not fire twenty requests at once
    items.slice(0, 8).reduce(function (p, it) { return p.then(function () { return hdLookup(it.name); }); }, Promise.resolve())
      .then(function () { preloadCW(items.slice(0, 3).map(function (it) { return { backdrop: hdUrl(it.name) }; })); });
  }

  /* ---------- "continue watching" rows that apps publish to LG Home ---------- */
  S.appRows = store.get('appRows', {});
  var lastAppRows = 0;
  function refreshAppContents(force) {
    if (DEMO) return Promise.resolve();
    if (!force && Date.now() - lastAppRows < 20000) return Promise.resolve();
    lastAppRows = Date.now();
    return luna('luna://com.webos.service.applicationmanager/getAllContents', {}).then(function (r) {
      var rows = {};
      (r.allContents || []).forEach(function (x) {
        var appId = String(x.launchPointId || '').replace(/_default$/, '');
        var isCW = function (c) { return /continue|nastavi|resume/i.test(c.category || ''); };
        var all = (x.contents || []).filter(function (c) { return c.titleText && c.image && c.image.url; });
        var cw = all.filter(isCW);
        if (!cw.length) return;   // only apps with a real Continue Watching row
        // what you're watching first, then the app's own picks to fill the row
        var items = cw.concat(all.filter(function (c) { return !isCW(c); })).slice(0, 10).map(function (c) {
          var img = c.image.url;
          var oc = c.onClick || {};
          return { kind: 'app', id: c.contentId, name: c.titleText, category: c.category, thumb: img, backdrop: img,
                   kicker: isCW(c) ? 'Nastavi gledati' : 'Preporučeno za tebe',
                   appId: oc.targetAppId || appId, contentTarget: oc.contentId || '', launchParam: oc.launchParam || '' };
        });
        rows[appId] = items;
      });
      var sig = function (o) { return JSON.stringify(Object.keys(o).sort().map(function (k) { return [k, o[k].map(function (i) { return i.name + '|' + i.kicker; })]; })); };
      var changed = sig(rows) !== sig(S.appRows);
      S.appRows = rows;   // always keep the fresh launch parameters (they expire)
      store.set('appRows', rows);
      preloadCW([].concat.apply([], Object.keys(rows).map(function (k) { return rows[k]; })));
      Object.keys(rows).forEach(function (k) { hdWarm(rows[k]); });
      if (changed) { S.cardsFor = null; updateShelf(true); }
    }).catch(function (e) { console.log('appContents', e); });
  }
  function shelfItems(a) {
    if (!a || a.key === SETTINGS_KEY) return [];
    var items = isStremio(a) ? S.cw : (S.appRows[a.id] || []);
    if (!items.length && L().fallback) items = S.cw;   // keep the row filled with what you're watching
    var mx = L().maxCards;
    return mx ? items.slice(0, mx) : items;
  }
  function activateItem(item) {
    if (!item) return;
    if (item.kind !== 'app') return playCW(item);
    var app = null;
    S.apps.forEach(function (x) { if (!app && x.id === item.appId) app = x; });
    var params = {};
    if (item.launchParam && typeof item.launchParam === 'object') for (var k in item.launchParam) params[k] = item.launchParam[k];
    else if (item.launchParam) params.contentTarget = item.launchParam;
    if (item.contentTarget) params.contentTarget = item.contentTarget;
    launch(app || { id: item.appId, title: item.name, params: {} }, params);
  }

  function refreshStremio(force) {
    if (!S.authKey) return Promise.resolve();
    var now = Date.now();
    if (!force && now - S.lastStremio < 20000) return Promise.resolve();
    S.lastStremio = now;
    return postJSON(STREMIO_API + 'datastoreGet', { authKey: S.authKey, collection: 'libraryItem', ids: [], all: true })
      .then(function (r) {
        if (r.error) throw new Error(r.error.message || 'Stremio greška');
        return buildContinueWatching(r.result || []);
      })
      .then(function (items) {
        if (JSON.stringify(items) === JSON.stringify(S.cw)) return;
        S.cw = items;
        store.set('cw', items);
        preloadCW(items);
        S.cardsFor = null;
        updateShelf(true);
      })
      .catch(function (e) { console.log('stremio', e); });
  }
  function stremioLogin(email, password) {
    return postJSON(STREMIO_API + 'login', { type: 'Login', email: email, password: password, facebook: false })
      .then(function (r) {
        if (r.error || !r.result) throw new Error((r.error && r.error.message) || 'Prijava nije uspjela');
        S.authKey = r.result.authKey;
        S.stremioUser = (r.result.user && r.result.user.email) || email;
        store.set('authKey', S.authKey);
        store.set('stremioUser', S.stremioUser);
        return refreshStremio(true);
      });
  }
  function playCW(item) {
    var app = stremioApp();
    if (!app) { toast('Stremio nije instaliran'); return; }
    // Stremio deep link format: stremio:///detail/{type}/{id}/{videoId}, ids unencoded (tt123:1:2)
    var path = 'detail/' + item.type + '/' + item.id + (item.videoId ? '/' + item.videoId : '');
    var index = Math.max(0, S.cw.indexOf(item));
    if (DEMO) { launch(app, { contentTarget: 'stremio:///' + path }); return; }
    // Stremio on webOS ignores deep links, so start it fresh (focus lands on its
    // Continue Watching row) and let dom-keys.js press the remote buttons to the item.
    toast('Otvaram ' + item.name + '…');
    setTimeout(leaving, 600);
    exec('luna-send -n 1 luna://com.webos.service.applicationManager/closeByAppId ' + shq(JSON.stringify({ id: app.id })) + ' >/dev/null 2>&1; sleep 0.5; ' +
         'luna-send -n 1 luna://com.webos.applicationManager/launch ' + shq(JSON.stringify({ id: app.id, params: { contentTarget: 'stremio:///' + path } })) + ' >/dev/null 2>&1; ' +
         'N=$(command -v node || echo /usr/bin/node); nohup "$N" /home/root/dom-keys.js play ' + index + ' > /tmp/dom-keys.log 2>&1 &', 15000)
      .catch(function () { launch(app, { contentTarget: 'stremio:///' + path }); });
  }
  function remaining(item) {
    if (!item.duration) return '';
    var min = Math.max(0, Math.round((item.duration - item.offset) / 60000));
    if (min >= 60) return 'Još ' + Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
    return 'Još ' + min + ' min';
  }
  function itemSub(item) {
    var parts = [];
    if (item.isNew) parts.push('Nova epizoda');
    if (item.season) parts.push('S' + item.season + ' · E' + item.episode);
    var r = remaining(item);
    if (r) parts.push(r);
    return parts.join('   ·   ');
  }

  /* ================= rendering ================= */
  var gearSvg = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

  // game consoles on HDMI: brand-coloured tile with a generic controller drawing
  var CONSOLES = [
    { re: /ps5|ps4|playstation/i, rgb: [0, 112, 209], from: '#1f6fd6', to: '#062a6e' },
    { re: /xbox/i, rgb: [16, 124, 16], from: '#2f9a2f', to: '#0b3d0b' },
    { re: /nintendo|switch/i, rgb: [230, 0, 18], from: '#e8323f', to: '#6e0710' }
  ];
  function consoleOf(a) {
    var t = (a.title || '') + ' ' + (a.id || '');
    for (var i = 0; i < CONSOLES.length; i++) if (CONSOLES[i].re.test(t)) return CONSOLES[i];
    return null;
  }
  var padSvg = '<svg class="tile-pad" viewBox="0 0 120 72" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round">' +
    '<path d="M30 8h60c14 0 22 10 26 26l3 16c2 12-10 20-19 11l-9-9H29l-9 9c-9 9-21 1-19-11l3-16C8 18 16 8 30 8z"/>' +
    '<path d="M33 24v16M25 32h16" stroke-linecap="round"/>' +
    '<circle cx="84" cy="26" r="3.5" fill="#fff" stroke="none"/><circle cx="94" cy="34" r="3.5" fill="#fff" stroke="none"/>' +
    '<circle cx="74" cy="34" r="3.5" fill="#fff" stroke="none"/><circle cx="84" cy="42" r="3.5" fill="#fff" stroke="none"/></svg>';

  function tileHtml(a) {
    if (a.key === SETTINGS_KEY) {
      return '<div class="tile-art">' + gearSvg + '<div class="tile-sheen"></div></div><div class="tile-label">Postavke</div>';
    }
    var con = consoleOf(a);
    if (con) {
      // own icon (e.g. a white logo) sits on the brand gradient; otherwise a generic controller
      var mark = a.customIcon ? '<img class="tile-conicon" src="' + esc(a.customIcon) + '" alt="">' : padSvg;
      return '<div class="tile-art"><div class="tile-fill" style="background:linear-gradient(150deg,' + con.from + ',' + con.to + ')"></div>' +
        mark + '<div class="tile-gloss"></div><div class="tile-sheen"></div></div><div class="tile-label">' + esc(a.title) + '</div>';
    }
    // Stremio with a custom (white) sign: brand gradient + sign + name
    if (a.customIcon && isStremio(a)) {
      return '<div class="tile-art"><div class="tile-fill" style="background:linear-gradient(160deg,#7b5cf5,#2a4fd6)"></div>' +
        '<div class="tile-brand"><img src="' + esc(a.customIcon) + '" alt=""><span>Stremio</span></div>' +
        '<div class="tile-gloss"></div><div class="tile-sheen"></div></div><div class="tile-label">' + esc(a.title) + '</div>';
    }
    var look = iconLooks[iconKey(a.icon)];
    var fill = look && look.color ? look.color : (a.color || '#3a3a3c');
    var art = '<div class="tile-fill" style="background:' + esc(fill) + '"></div>';
    if (a.icon) art += '<img class="tile-icon" src="' + esc(a.icon) + '" alt="">';
    else art += '<div class="tile-letter">' + esc((a.title || '?').charAt(0)) + '</div>';
    return '<div class="tile-art">' + art + '<div class="tile-gloss"></div><div class="tile-sheen"></div></div><div class="tile-label">' + esc(a.title) + '</div>';
  }

  /* ---------- icon look: make small webOS icons fill the tile like Apple TV art ---------- */
  var iconLooks = store.get('iconLooks3', {});
  // most saturated colour in the icon (the brand colour), or null for grey icons
  function accentOf(d) {
    var list = [];
    for (var k = 0; k < d.length; k += 4) {
      if (d[k + 3] < 200) continue;
      var r = d[k], g = d[k + 1], b = d[k + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 40) continue;
      list.push([(mx - mn) / mx * (mx / 255), r, g, b]);
    }
    if (!list.length) return null;
    list.sort(function (x, y) { return y[0] - x[0]; });
    var top = list.slice(0, Math.max(3, Math.round(list.length * 0.1)));
    if (top[0][0] < 0.3) return null;
    var c = [0, 0, 0];
    top.forEach(function (t) { c[0] += t[1]; c[1] += t[2]; c[2] += t[3]; });
    return 'rgb(' + c.map(function (v) { return Math.round(v / top.length); }).join(',') + ')';
  }
  function iconKey(src) { return (src || '').replace(/\?.*$/, ''); }
  function analyzeIcon(img) {
    try {
      var n = 64, c = document.createElement('canvas');
      c.width = c.height = n;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, n, n);
      var d = x.getImageData(0, 0, n, n).data;
      var px = [], transp = 0, tot = 0;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var ring = Math.min(i, j, n - 1 - i, n - 1 - j);
        if (ring !== 1) continue;                // outermost ring: background, not the logo
        var ci = Math.min(i, n - 1 - i), cj = Math.min(j, n - 1 - j);
        if (ci < 9 && cj < 9) continue;          // skip rounded corners
        var k = (j * n + i) * 4; tot++;
        if (d[k + 3] < 200) { transp++; continue; }
        px.push([d[k], d[k + 1], d[k + 2]]);
      }
      var ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      if (!px.length || transp / tot > 0.25) return { mode: 'trans', accent: accentOf(d), box: contentBox(d, n, null), ar: ar };
      var m = [0, 0, 0];
      px.forEach(function (p) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; });
      m = m.map(function (v) { return Math.round(v / px.length); });
      var spread = 0;
      px.forEach(function (p) { spread += Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) + Math.abs(p[2] - m[2]); });
      spread /= px.length;
      var accent = accentOf(d);
      if (spread > 60) return { mode: 'photo', accent: accent };  // picture icon: fill the tile with it
      return { mode: 'solid', color: 'rgb(' + m.join(',') + ')', accent: accent, box: contentBox(d, n, m), ar: ar };
    } catch (e) { return null; }                  // canvas blocked: keep defaults
  }
  // bounding box of the actual logo (pixels that differ from the background), as fractions
  function analyzeViaBlob(src, cb) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.responseType = 'blob';
      xhr.onload = function () {
        if (!xhr.response || !(xhr.status === 0 || xhr.status === 200)) return cb(null);
        var u = URL.createObjectURL(xhr.response), im = new Image();
        im.onload = function () { var l = analyzeIcon(im); URL.revokeObjectURL(u); cb(l); };
        im.onerror = function () { URL.revokeObjectURL(u); cb(null); };
        im.src = u;
      };
      xhr.onerror = function () { cb(null); };
      xhr.send();
    } catch (e) { cb(null); }
  }
  function contentBox(d, n, bg) {
    var x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var k = (y * n + x) * 4, on;
      if (bg) on = d[k + 3] > 60 && Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 60;
      else on = d[k + 3] > 60;
      if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    return { x: x0 / n, y: y0 / n, w: (x1 - x0 + 1) / n, h: (y1 - y0 + 1) / n };
  }
  // every logo gets about the same visual size: fit its content into LOGO_W x LOGO_H, centred
  var TILE_W = 300, TILE_H = 180, LOGO_W = 196, LOGO_H = 100;
  function applyLook(el, look) {
    if (!look) return;
    el.classList.remove('m-solid', 'm-photo', 'm-trans');
    el.classList.add('m-' + look.mode);
    if (look.color) el.querySelector('.tile-fill').style.background = look.color;
    var img = el.querySelector('.tile-icon');
    if (!img || !look.box || !look.ar || look.mode === 'photo') return;
    var b = look.box, ar = look.ar;
    // image drawn W x H (H = W / ar); content is b.w*W wide and b.h*H tall
    var W = Math.min(LOGO_W / b.w, (LOGO_H / b.h) * ar, 900);
    var H = W / ar;
    img.style.width = Math.round(W) + 'px';
    img.style.height = Math.round(H) + 'px';
    img.style.margin = '0';
    img.style.left = Math.round(TILE_W / 2 - (b.x + b.w / 2) * W) + 'px';
    img.style.top = Math.round(TILE_H / 2 - (b.y + b.h / 2) * H) + 'px';
  }
  var saveLooksTimer;
  var gridSig = '';
  function tileSig(list) {
    return JSON.stringify(list.map(function (a) { return [a.key, a.title, a.icon, a.color, a.customIcon || '']; }));
  }
  function renderGrid() {
    gridSig = tileSig(S.list);
    var g = $('#grid');
    g.innerHTML = '';
    S.list.forEach(function (a, i) {
      var el = document.createElement('div');
      el.className = 'tile' + (a.key === SETTINGS_KEY ? ' tile-settings' : '');
      el.innerHTML = tileHtml(a);
      el.addEventListener('mouseenter', function () { if (!pointerMoved()) return; if (!S.moving && S.zone !== 'settings') { S.zone = 'grid'; setIdx(i); } });
      el.addEventListener('mousemove', function (ev) { tiltFromPointer(el, ev); });
      el.addEventListener('mouseleave', function () { resetTilt(el); });
      el.addEventListener('click', function () { if (S.zone === 'settings') return; S.zone = 'grid'; setIdx(i); activate(); });
      var img = el.querySelector('.tile-icon');
      if (img) {
        applyLook(el, iconLooks[iconKey(a.icon)] || (a.color ? { mode: 'solid' } : { mode: 'trans' }));
        img.onload = function () {
          var src = img.getAttribute('src'), k = iconKey(src), old = iconLooks[k];
          if (old && old.src === src) return;   // already analysed this exact file
          var done = function (look) {
            // canvas unavailable: custom icons carry their own background, show them edge to edge
            if (!look && a.customIcon) look = { mode: 'photo' };
            if (!look) return;
            look.src = src;
            applyLook(el, look);
            iconLooks[k] = look;
            clearTimeout(saveLooksTimer);
            saveLooksTimer = setTimeout(function () { store.set('iconLooks3', iconLooks); }, 1500);
            // the ambient background uses the icon's colour: refresh it if this tile is focused
            var cur = S.list[S.idx];
            if (cur && cur.key === a.key && (!old || old.accent !== look.accent || old.color !== look.color)) { shelfKey = ''; bgKey = ''; updateShelf(); }
          };
          var look = analyzeIcon(img);
          if (look) return done(look);
          // file:// images taint the canvas on the TV; a blob: copy of the same file doesn't
          analyzeViaBlob(img.getAttribute('src'), done);
        };
        img.onerror = function () {
          // broken custom icon -> the app's own icon
          if (a.fallbackIcon && img.getAttribute('src') !== a.fallbackIcon) { img.src = a.fallbackIcon; return; }
          if (a.iconDirect && img.src.indexOf('file:') !== 0) { img.src = a.iconDirect; return; }
          var l = document.createElement('div'); l.className = 'tile-letter'; l.textContent = (a.title || '?').charAt(0);
          img.parentNode.replaceChild(l, img);
        };
      }
      g.appendChild(el);
    });
    applyFocus();
  }
  function renderCards() {
    var c = $('#cards');
    c.innerHTML = '';
    var cur = S.list[S.idx];
    var items = shelfItems(cur);
    S.cardsFor = cur ? cur.key : null;
    items.forEach(function (item, i) {
      var el = document.createElement('div');
      el.className = 'card';
      var pct = item.duration ? Math.min(100, Math.round(item.offset / item.duration * 100)) : 0;
      el.innerHTML = '<div class="card-title">' + esc(item.name) + (item.season ? ' · S' + item.season + 'E' + item.episode : '') + '</div>' +
        '<div class="card-bar"><div style="width:' + pct + '%"></div></div>';
      setImage(el, [item.thumb, item.thumbFallback, item.poster]);
      el.addEventListener('mouseenter', function () { if (!pointerMoved()) return; if (S.zone !== 'settings' && !S.moving) { S.zone = 'shelf'; S.card = i; applyFocus(); updateShelf(); } });
      // look the item up at click time: launch parameters are refreshed in the background
      el.addEventListener('click', function () { if (S.zone !== 'settings' && !S.moving) activateItem(shelfItems(S.list[S.idx])[i]); });
      c.appendChild(el);
    });
    if (S.card >= items.length) S.card = Math.max(0, items.length - 1);
  }
  // first URL that actually loads (synchronously when it's already preloaded)
  function firstImage(urls, cb) {
    urls = urls.filter(Boolean);
    var p = urls.length && preloaded[urls[0]];
    if (p && p.complete && p.naturalWidth > 0) return cb(urls[0]);
    (function next(i) {
      if (i >= urls.length) return cb(null);
      var im = new Image();
      im.onload = function () { cb(urls[i]); };
      im.onerror = function () { next(i + 1); };
      im.src = urls[i];
    })(0);
  }
  function setImage(el, urls) {
    firstImage(urls, function (u) { if (u) el.style.backgroundImage = 'url("' + u + '")'; });
  }

  /* ---------- background ---------- */
  var bgFront = 'A', bgKey = '';
  function setBackground(key, urls, fb) {
    if (key === bgKey) return;
    bgKey = key;
    firstImage(urls, function (u) {
      if (bgKey !== key) return;   // a newer background was requested meanwhile
      var back = bgFront === 'A' ? 'B' : 'A';
      var layer = $('#bg' + back), img = layer.querySelector('.bg-img');
      img.className = 'bg-img' + (u && fb && (fb.soft || fb.softUrl === u) ? ' soft' : '');
      img.style.backgroundImage = u ? 'url("' + u + '")' : ((fb && fb.ambient) || '');
      img.style.backgroundColor = u ? '#111' : ((fb && fb.color) || '#0b0b0d');
      layer.classList.add('on');
      $('#bg' + bgFront).classList.remove('on');
      bgFront = back;
      var bl = $('#bgblur');
      bl.style.backgroundImage = img.style.backgroundImage;
      bl.style.backgroundColor = img.style.backgroundColor;
    });
  }

  /* ---------- ambient background for apps without artwork ---------- */
  function toRgb(c) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || '');
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    m = /rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(c || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function brandColor(a) {
    var con = consoleOf(a);
    if (con) return con.rgb.slice();
    var look = iconLooks[iconKey(a.icon)] || {};
    return toRgb(look.accent) || toRgb(look.color) || toRgb(a.color) || [72, 72, 80];
  }
  function ambientFor(a) {
    var c = brandColor(a);
    // keep very light colours (white tiles) from washing out the screen
    var lum = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
    if (lum > 0.7) c = c.map(function (v) { return Math.round(v * 0.55); });
    var dark = c.map(function (v) { return Math.round(v * 0.22); });
    function rgba(x, al) { return 'rgba(' + x[0] + ',' + x[1] + ',' + x[2] + ',' + al + ')'; }
    return [
      'radial-gradient(ellipse 55% 75% at 78% 18%, ' + rgba(c, 0.85) + ' 0%, ' + rgba(c, 0) + ' 70%)',
      'radial-gradient(ellipse 45% 55% at 30% 0%, ' + rgba(c, 0.35) + ' 0%, ' + rgba(c, 0) + ' 70%)',
      'radial-gradient(ellipse 70% 60% at 10% 90%, ' + rgba(dark, 0.9) + ' 0%, rgba(0,0,0,0) 70%)',
      'linear-gradient(160deg, rgb(' + dark.join(',') + ') 0%, #050506 75%)'
    ].join(', ');
  }

  /* ---------- top shelf ---------- */
  var shelfTimer = null, shelfKey = '';
  function updateShelf(force) {
    clearTimeout(shelfTimer);
    shelfTimer = setTimeout(function () { drawShelf(force); }, S.zone === 'shelf' ? 30 : 120);
  }
  function drawShelf(force) {
    var a = S.list[S.idx];
    var shelf = $('#shelf');
    var items = shelfItems(a);
    var showCards = items.length > 0;
    if (a && S.cardsFor !== a.key) { renderCards(); applyFocus(); }
    if (S.zone === 'shelf' && !showCards) { S.zone = 'grid'; applyFocus(); }
    shelf.classList.toggle('has-cards', showCards);

    var key, info;
    if (showCards) {
      var item = items[S.zone === 'shelf' ? Math.min(S.card, items.length - 1) : 0];
      if (item.kind === 'app') {
        var hd = hdUrl(item.name);
        key = 'appcw:' + item.appId + ':' + item.id + (hd ? ':hd' : '');
        info = { kicker: item.kicker || 'Nastavi gledati', title: item.name, sub: '', progress: -1,
                 bg: [hd, item.backdrop], fb: { color: '#202024', softUrl: item.backdrop } };
        if (!hd) hdLookup(item.name).then(function (id) { if (id) { shelfKey = ''; updateShelf(true); } });
      } else {
      key = 'cw:' + item.id + ':' + item.videoId;
      info = {
        kicker: 'Nastavi gledati', title: item.name, logo: item.logo, sub: itemSub(item),
        progress: item.duration ? item.offset / item.duration : -1,
        bg: [item.backdrop, item.poster], fb: { color: '#202024' }
      };
      }
    }
    // Karusel: while on the apps, the big line names the app; the art waits for the card row
    if (S.layout === 'carousel' && S.zone !== 'shelf' && a && a.key !== SETTINGS_KEY) {
      var first = showCards ? items[0] : null;
      key = 'car:' + a.key;
      info = { kicker: '', title: a.title, progress: -1, bg: [], fb: { ambient: ambientFor(a) },
               sub: first ? 'Nastavi gledati: ' + first.name + (first.season ? ' · S' + first.season + ' · E' + first.episode : '') : '' };
    } else if (info) {
      // already set from the card row
    } else if (a && a.key === SETTINGS_KEY) {
      key = 'settings';
      info = { kicker: '', title: 'Postavke', sub: 'Stremio račun, skrivanje aplikacija i ostalo', progress: -1, bg: [], fb: { color: '#26262a' } };
    } else if (a) {
      key = 'app:' + a.key + (consoleOf(a) || S.wall.on ? '' : (a.shot || ''));
      var sub = isStremio(a) ? (S.authKey ? 'Nema ničega za nastaviti' : 'Prijavi se u Postavkama za "Nastavi gledati"') : '';
      info = { kicker: '', title: a.title, sub: sub, progress: -1, bg: consoleOf(a) ? [a.custom ? a.bg : ''] : [S.wall.on ? '' : a.shot, a.bg], fb: { ambient: ambientFor(a) } };
    } else return;

    if (key === shelfKey && !force) return;
    shelfKey = key;
    setBackground(key, info.bg, info.fb);

    var box = $('#shelf-info');
    box.classList.add('swap');
    setTimeout(function () {
      $('#shelf-kicker').textContent = info.kicker || '';
      var t = $('#shelf-title'), logo = $('#shelf-logo');
      t.textContent = info.title || '';
      t.classList.remove('hide');
      logo.classList.remove('ok');
      if (info.logo) {
        logo.onload = function () { if (shelfKey === key) { logo.classList.add('ok'); t.classList.add('hide'); } };
        logo.onerror = function () { logo.classList.remove('ok'); t.classList.remove('hide'); };
        logo.src = info.logo;
      } else logo.removeAttribute('src');
      $('#shelf-sub').textContent = info.sub || '';
      var p = $('#shelf-progress');
      p.classList.toggle('on', info.progress >= 0);
      p.firstElementChild.style.width = Math.round(Math.max(0, info.progress) * 100) + '%';
      box.classList.remove('swap');
    }, 110);
  }

  /* ---------- focus ---------- */
  function rowOf(i) { return Math.floor(i / cols()); }
  function applyFocus() {
    var tiles = document.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.toggle('focus', S.zone === 'grid' && i === S.idx);
      tiles[i].classList.toggle('moving', S.moving && i === S.idx);
    }
    var cards = document.querySelectorAll('.card');
    for (var j = 0; j < cards.length; j++) cards[j].classList.toggle('focus', S.zone === 'shelf' && j === S.card);
    var lay = L(), r = rowOf(S.idx);
    var tabEls = document.querySelectorAll('#tabs .tab');
    for (var tb = 0; tb < tabEls.length; tb++) tabEls[tb].classList.toggle('focus', S.zone === 'tabs' && tb === S.tab);
    // card row/column/grid: keep the focused card on screen
    var cardsEl = $('#cards'), ax = lay.cardAxis || 'h';
    if (ax === 'h') {
      var cstep = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : 302;
      var cview = lay.cardView || 1692, cvis = Math.max(1, Math.floor((cview + 30) / cstep));
      var cmax = Math.max(0, cards.length * cstep - 30 - cview);
      var cx = S.zone === 'shelf' ? Math.min(cmax, Math.max(0, S.card - (cvis - 1)) * cstep) : 0;
      cardsEl.style.transform = 'translateX(' + (-cx) + 'px)';
    } else {
      var per = ax === 'grid3' ? 3 : 1;
      var rstep = cards.length > per ? cards[per].offsetTop - cards[0].offsetTop : 0;
      var row = Math.floor(S.card / per), cy = S.zone === 'shelf' ? Math.max(0, row - 1) * rstep : 0;
      cardsEl.style.transform = 'translateY(' + (-cy) + 'px)';
    }
    var grid = $('#grid');
    if (lay.mode === 'list') {
      var lstep = tiles.length > 1 ? tiles[1].offsetTop - tiles[0].offsetTop : 101;
      var lvis = Math.max(1, Math.floor(lay.listView / lstep));
      var ly = Math.min(Math.max(0, tiles.length * lstep - lay.listView), Math.max(0, S.idx - (lvis - 2)) * lstep);
      grid.style.transform = 'translateY(' + (-ly) + 'px)';
    } else if (lay.mode === 'carousel') {
      // focused app big in the middle, neighbours turned away in 3D
      var OFF = [0, 420, 690, 880], SC = [1.6, 1, 0.74, 0.6], OP = [1, 0.85, 0.45, 0];
      for (var t = 0; t < tiles.length; t++) {
        var d = t - S.idx, ad = Math.min(3, Math.abs(d)), art = tiles[t].querySelector('.tile-art');
        tiles[t].style.left = (810 + (d < 0 ? -1 : 1) * OFF[ad]) + 'px';
        tiles[t].style.opacity = OP[ad];
        tiles[t].style.zIndex = 10 - ad;
        art.style.setProperty('--s', SC[ad]);
        art.style.setProperty('--ry', d === 0 ? '0deg' : (d > 0 ? '-30deg' : '30deg'));
      }
      grid.style.transform = 'none';
    } else if (lay.mode === 'accordion') {
      // the focused app is a wide panel, the others are narrow strips; the art sits under the panel
      var ASTEP = 168, AWIDE = 888, AVIEW = 1728;
      var atotal = AWIDE + Math.max(0, tiles.length - 1) * ASTEP;
      var atx = Math.max(0, Math.min(atotal - AVIEW, S.idx * ASTEP - 2 * ASTEP));
      grid.style.transform = 'translateX(' + (-atx) + 'px)';
      stage.style.setProperty('--acc-x', (96 + S.idx * ASTEP - atx) + 'px');
    } else if (lay.mode === 'dock') {
      var step = lay.step || (tiles.length > 1 ? tiles[1].offsetLeft - tiles[0].offsetLeft : 348);
      var gap = step - (tiles[0] ? tiles[0].offsetWidth : 300);
      var vis = Math.max(1, Math.floor((lay.view + gap) / step));
      var gmax = Math.max(0, tiles.length * step - gap - lay.view);
      grid.style.transform = 'translateX(' + (-Math.min(gmax, Math.max(0, S.idx - (vis - 1)) * step)) + 'px)';
    } else {
      var y = (S.zone === 'shelf' || r === 0) ? 0 : (430 - 640 - r * ROW_H);
      grid.style.transform = 'translateY(' + y + 'px)';
    }
    stage.classList.toggle('scrolled', !lay.mode && S.zone !== 'shelf' && r > 0);
    stage.classList.toggle('zone-shelf', S.zone === 'shelf');
    stage.classList.toggle('zone-tabs', S.zone === 'tabs');
    stage.classList.toggle('moving-mode', S.moving);
  }
  function setIdx(i, dir) {
    i = Math.max(0, Math.min(S.list.length - 1, i));
    var changed = i !== S.idx;
    S.idx = i;
    applyFocus();
    if (dir) nudge(dir);
    if (changed || S.zone === 'grid') updateShelf();
  }

  /* ---------- parallax tilt ---------- */
  function focusedTileEl() { return document.querySelectorAll('.tile')[S.idx]; }
  function nudge(dir) {
    if (S.layout === 'carousel' || S.layout === 'sidebar' || S.layout === 'harmonika') return;
    var el = focusedTileEl();
    if (!el) return;
    var art = el.querySelector('.tile-art');
    var rx = dir === 'up' ? 6 : dir === 'down' ? -6 : 0;
    var ry = dir === 'left' ? -7 : dir === 'right' ? 7 : 0;
    art.style.setProperty('--rx', rx + 'deg');
    art.style.setProperty('--ry', ry + 'deg');
    el.style.setProperty('--gx', (50 + ry * 6) + '%');
    el.querySelector('.tile-sheen').style.setProperty('--gx', (50 + ry * 6) + '%');
    el.querySelector('.tile-sheen').style.setProperty('--gy', (rx > 0 ? -20 : rx < 0 ? 40 : 0) + '%');
    clearTimeout(el._t);
    el._t = setTimeout(function () { art.style.setProperty('--rx', '0deg'); art.style.setProperty('--ry', '0deg'); }, 260);
  }
  function tiltFromPointer(el, ev) {
    if (S.layout === 'carousel' || S.layout === 'sidebar' || S.layout === 'harmonika') return;
    if (!el.classList.contains('focus')) return;
    var r = el.getBoundingClientRect();
    var px = (ev.clientX - r.left) / r.width - 0.5, py = (ev.clientY - r.top) / r.height - 0.5;
    var art = el.querySelector('.tile-art');
    clearTimeout(el._t);
    art.style.setProperty('--rx', (-py * 12).toFixed(1) + 'deg');
    art.style.setProperty('--ry', (px * 14).toFixed(1) + 'deg');
    var sh = el.querySelector('.tile-sheen');
    sh.style.setProperty('--gx', ((px + 0.5) * 100).toFixed(0) + '%');
    sh.style.setProperty('--gy', ((py + 0.5) * 100 - 30).toFixed(0) + '%');
  }
  function resetTilt(el) {
    if (S.layout === 'carousel' || S.layout === 'sidebar' || S.layout === 'harmonika') return;
    var art = el.querySelector('.tile-art');
    art.style.setProperty('--rx', '0deg'); art.style.setProperty('--ry', '0deg');
  }

  /* ================= actions ================= */
  function activate() {
    var a = S.list[S.idx];
    if (!a) return;
    if (a.key === SETTINGS_KEY) openSettings();
    else launch(a);
  }
  function startMove() {
    var a = S.list[S.idx];
    if (!a || a.key === SETTINGS_KEY) return;
    S.moving = true;
    applyFocus();
  }
  function endMove() {
    S.moving = false;
    saveOrder();
    applyFocus();
  }
  function moveTile(delta) {
    var to = S.idx + delta;
    var last = S.list.length - 2; // settings tile stays last
    if (to < 0 || to > last) return;
    var a = S.list.splice(S.idx, 1)[0];
    S.list.splice(to, 0, a);
    S.idx = to;
    renderGrid();
  }

  /* ================= keys ================= */
  var okTimer = null, okHeld = false, okLong = false;
  function onKeyDown(e) {
    var k = e.keyCode;
    if (stage.classList.contains('out')) { fadeIn(true); if (e.preventDefault) e.preventDefault(); return; }
    if (S.zone === 'settings') { settingsKey(e); return; }
    // remotes with media or colour keys: play/pause or yellow keeps the wallpaper, fast-forward or blue shows the next one
    if (S.wall.on && (k === 415 || k === 19 || k === 10252 || k === 405)) { wallTogglePause(); e.preventDefault(); return; }
    if (S.wall.on && (k === 417 || k === 406)) { wallNext(true); e.preventDefault(); return; }
    if (S.zone === 'tabs' && k !== KEY.OK) {
      var tn = document.querySelectorAll('#tabs .tab').length;
      if (k === KEY.LEFT) S.tab = Math.max(0, S.tab - 1);
      else if (k === KEY.RIGHT) S.tab = Math.min(tn - 1, S.tab + 1);
      else if (k === KEY.DOWN || k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) S.zone = 'grid';
      else return;
      e.preventDefault(); applyFocus(); return;
    }
    if (k === KEY.OK) {
      e.preventDefault();
      if (okHeld) return; // auto-repeat
      okHeld = true; okLong = false;
      if (S.zone === 'grid' && !S.moving) {
        okTimer = setTimeout(function () { okLong = true; startMove(); }, 700);
      }
      return;
    }
    if (S.moving) {
      e.preventDefault();
      if (k === KEY.LEFT) moveTile(-1);
      else if (k === KEY.RIGHT) moveTile(1);
      else if (k === KEY.UP) moveTile(-cols());
      else if (k === KEY.DOWN) moveTile(cols());
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) endMove();
      return;
    }
    if (S.zone === 'grid') {
      var COLS = cols(), col = S.idx % COLS;
      var ek = { up: KEY.UP, down: KEY.DOWN, right: KEY.RIGHT }[L().enter || 'up'];
      if (L().tabs && k === KEY.UP) { S.zone = 'tabs'; S.tab = 0; applyFocus(); e.preventDefault(); return; }
      if (k === ek && (ek !== KEY.UP || rowOf(S.idx) === 0) && shelfItems(S.list[S.idx]).length) {
        S.zone = 'shelf'; S.card = 0; applyFocus(); updateShelf(); e.preventDefault(); return;
      }
      if (k === KEY.LEFT && col > 0) setIdx(S.idx - 1, 'left');
      else if (k === KEY.RIGHT && col < COLS - 1 && S.idx + 1 < S.list.length) setIdx(S.idx + 1, 'right');
      else if (k === KEY.DOWN) {
        if (S.idx + COLS < S.list.length) setIdx(S.idx + COLS, 'down');
        else if (rowOf(S.list.length - 1) > rowOf(S.idx)) setIdx(S.list.length - 1, 'down');
        else nudge('down');
      } else if (k === KEY.UP) {
        if (rowOf(S.idx) > 0) setIdx(S.idx - COLS, 'up');
        else if (shelfItems(S.list[S.idx]).length) { S.zone = 'shelf'; S.card = 0; applyFocus(); updateShelf(); }
        else nudge('up');
      } else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) { S.zone = 'grid'; setIdx(0); }
      else return;
      e.preventDefault();
      return;
    }
    if (S.zone === 'shelf') {
      var n = shelfItems(S.list[S.idx]).length, c = S.card, ax = L().cardAxis || 'h', out = false, to = c;
      var exitKey = { up: KEY.DOWN, down: KEY.UP, right: KEY.LEFT }[L().enter || 'up'];
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) out = true;
      else if (ax === 'h') {
        if (k === KEY.LEFT) to = c - 1; else if (k === KEY.RIGHT) to = c + 1;
        else if (k === exitKey) out = true; else return;
      } else if (ax === 'v') {
        if (k === KEY.UP) to = c - 1;
        else if (k === KEY.DOWN) { if (c < n - 1) to = c + 1; else out = true; }
        else if (k === KEY.LEFT) out = true; else return;
      } else {   // grid of 3 columns
        if (k === KEY.LEFT) { if (c % 3) to = c - 1; else out = true; }
        else if (k === KEY.RIGHT) { if (c % 3 < 2) to = c + 1; }
        else if (k === KEY.UP) to = c - 3; else if (k === KEY.DOWN) to = c + 3; else return;
      }
      e.preventDefault();
      if (out) { S.zone = 'grid'; applyFocus(); updateShelf(); return; }
      if (to >= 0 && to < n && to !== c) { S.card = to; applyFocus(); updateShelf(); }
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Magic Remote scroll wheel: one notch = one step up/down (throttled)
  var wheelAcc = 0, wheelLast = 0;
  // ignore hover caused by content scrolling under a still pointer
  var lastMouseMove = 0;
  document.addEventListener('mousemove', function () { lastMouseMove = Date.now(); }, true);
  function pointerMoved() { return Date.now() - lastMouseMove < 150; }
  document.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (S.moving) return;
    wheelAcc += e.deltaY;
    var now = Date.now();
    if (Math.abs(wheelAcc) < 30 || now - wheelLast < 160) return;
    var k = wheelAcc > 0 ? KEY.DOWN : KEY.UP;
    wheelAcc = 0; wheelLast = now;
    if (S.zone === 'shelf' && k === KEY.UP) return;
    if (S.zone === 'settings') { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); settingsKey({ keyCode: k, preventDefault: function () {} }); return; }
    onKeyDown({ keyCode: k, preventDefault: function () {} });
  }, { passive: false });
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    if (!okHeld) return;               // press began elsewhere (e.g. in Settings, or before we were shown)
    okHeld = false;
    if (S.zone === 'settings') return;
    clearTimeout(okTimer);
    if (okLong) return;
    if (S.moving) { endMove(); return; }
    if (S.zone === 'grid') activate();
    else if (S.zone === 'shelf') activateItem(shelfItems(S.list[S.idx])[S.card]);
    else if (S.zone === 'tabs') tabAct(S.tab);
  });

  function applyLayout() {
    if (!LAYOUTS[S.layout]) S.layout = 'classic';
    LAYOUT_ORDER.forEach(function (k) { stage.classList.toggle('layout-' + k, S.layout === k); });
    stage.classList.toggle('dock', L().mode === 'dock');
    stage.classList.toggle('boxed', !!L().boxed);
    stage.style.setProperty('--dock-scale', L().scale || 1);
    $('#grid').style.transform = 'none';
    if (S.list.length) renderGrid();
    S.cardsFor = null; shelfKey = ''; bgKey = '';
    if (S.zone === 'shelf' || S.zone === 'tabs') S.zone = 'grid';
    updateShelf(true);
  }

  /* ================= tabs (layout Traka) ================= */
  function tabAct(i) {
    var el = document.querySelectorAll('#tabs .tab')[i];
    if (!el) return;
    if (el.getAttribute('data-tab') === 'settings') openSettings();
    else { S.zone = 'grid'; applyFocus(); }
  }
  (function () {
    var els = document.querySelectorAll('#tabs .tab');
    for (var i = 0; i < els.length; i++) (function (i) {
      els[i].addEventListener('mouseenter', function () { if (!pointerMoved() || S.zone === 'settings' || S.moving) return; S.zone = 'tabs'; S.tab = i; applyFocus(); });
      els[i].addEventListener('click', function () { if (S.zone !== 'settings' && !S.moving) tabAct(i); });
    })(i);
  })();

  /* ================= wallpapers from the internet ================= */
  var WALL_SRC = { bing: 'Fotografija dana (Bing)', wiki: 'Krajolici (Wikimedia)' };
  var WALL_SRC_ORDER = ['bing', 'wiki'];
  var WALL_MINS = [1, 5, 15, 30, 60];
  var WALL = { list: store.get('wallList', []), listSrc: store.get('wallListSrc', ''), listAt: store.get('wallListAt', 0),
               pos: store.get('wallPos', -1), cur: store.get('wallCur', null), front: 'A', shownAt: 0, loading: null };
  function wallSave() { store.set('wall', S.wall); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function plain(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
  function wallFetchBing() {
    // the last two weeks of daily photos, from a few regions (they differ on some days)
    var calls = [];
    ['en-US', 'de-DE', 'ja-JP'].forEach(function (m) {
      [0, 7].forEach(function (i) {
        calls.push(getJSON('https://www.bing.com/HPImageArchive.aspx?format=js&idx=' + i + '&n=8&mkt=' + m).catch(function () { return null; }));
      });
    });
    return Promise.all(calls).then(function (rs) {
      var seen = {}, out = [];
      rs.forEach(function (r) {
        ((r && r.images) || []).forEach(function (im) {
          if (!im.urlbase) return;
          var id = (/OHR\.([^_]+)/.exec(im.urlbase) || [0, im.urlbase])[1];
          if (seen[id]) return;
          seen[id] = 1;
          var m = /^(.*?)\s*\((.*)\)\s*$/.exec(String(im.copyright || ''));
          out.push({ url: 'https://www.bing.com' + im.urlbase + '_1920x1080.jpg', title: m ? m[1] : (im.title || ''), credit: m ? m[2] : '' });
        });
      });
      return out;
    });
  }
  function wallFetchWiki() {
    // featured landscape photos from Wikimedia Commons, wide ones only
    var base = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=categorymembers&gcmtitle=' +
      encodeURIComponent('Category:Featured pictures of landscapes') + '&gcmtype=file&gcmlimit=50&gcmsort=timestamp&gcmdir=desc' +
      '&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=1920&iiextmetadatafilter=Artist%7CObjectName';
    var out = [];
    function page(cont, left) {
      return getJSON(base + (cont ? '&gcmcontinue=' + encodeURIComponent(cont) : '')).then(function (r) {
        var pages = (r && r.query && r.query.pages) || {};
        Object.keys(pages).forEach(function (k) {
          var p = pages[k], ii = p.imageinfo && p.imageinfo[0];
          if (!ii || !ii.thumburl || !/\.jpe?g$/i.test(ii.url || '')) return;
          var ar = ii.width / ii.height;
          if (ii.width < 1920 || ar < 1.45 || ar > 2.1) return;
          var md = ii.extmetadata || {};
          out.push({ url: ii.thumburl, title: plain(md.ObjectName && md.ObjectName.value) || String(p.title || '').replace(/^File:|\.\w+$/g, ''),
                     credit: plain(md.Artist && md.Artist.value).slice(0, 60) });
        });
        var next = r && r['continue'] && r['continue'].gcmcontinue;
        return next && left > 1 ? page(next, left - 1) : out;
      }, function (e) { if (out.length) return out; throw e; });
    }
    return page('', 4);
  }
  function demoWall() {
    return [['#1d3b6e', '#0b1326'], ['#6e2a1d', '#1b0d0a'], ['#1d6e4b', '#08140f']].map(function (c, i) {
      return { title: 'Demo pozadina ' + (i + 1), credit: 'demo',
               url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="' + (500 + i * 400) + '" cy="380" r="260" fill="rgba(255,255,255,.12)"/></svg>') };
    });
  }
  function wallList(force) {
    var fresh = WALL.list.length && WALL.listSrc === S.wall.src && Date.now() - WALL.listAt < 12 * 3600 * 1000;
    if (fresh && !force) return Promise.resolve(WALL.list);
    if (WALL.loading) return WALL.loading;
    var src = S.wall.src;
    var f = DEMO ? Promise.resolve(demoWall()) : (src === 'wiki' ? wallFetchWiki() : wallFetchBing());
    WALL.loading = f.then(function (list) {
      WALL.loading = null;
      if (!list || !list.length) throw new Error('no wallpapers');
      WALL.list = shuffle(list); WALL.listSrc = src; WALL.listAt = Date.now(); WALL.pos = -1;
      store.set('wallList', WALL.list); store.set('wallListSrc', src); store.set('wallListAt', WALL.listAt);
      return WALL.list;
    }, function (e) {
      WALL.loading = null;
      if (WALL.list.length && WALL.listSrc === src) return WALL.list;   // keep going with yesterday's list
      throw e;
    });
    return WALL.loading;
  }
  function wallShow(item) {
    if (!item || !item.url) return;
    var im = new Image();
    im.onload = function () {
      if (!S.wall.on) return;
      var back = WALL.front === 'A' ? 'B' : 'A';
      $('#wall' + back).style.backgroundImage = 'url("' + item.url + '")';
      $('#wall' + back).classList.add('on');
      $('#wall' + WALL.front).classList.remove('on');
      WALL.front = back; WALL.cur = item; WALL.shownAt = Date.now(); WALL.failed = 0;
      store.set('wallCur', item);
      if (S.zone === 'settings') renderSettings();
    };
    im.onerror = function () {
      // skip a picture that does not load, but do not spin through the whole list when offline
      WALL.failed = (WALL.failed || 0) + 1;
      if (WALL.failed <= 3 && !S.wall.paused) wallNext(false);
    };
    im.src = item.url;
  }
  function wallNext(manual) {
    wallList(false).then(function (list) {
      WALL.pos = (WALL.pos + 1) % list.length;
      store.set('wallPos', WALL.pos);
      wallShow(list[WALL.pos]);
    }, function () { if (manual) toast('Ne mogu dohvatiti pozadine. Provjeri internet.'); });
  }
  function wallTick() {
    if (!S.wall.on || S.wall.paused || document.hidden) return;
    if (Date.now() - WALL.shownAt >= S.wall.mins * 60000) wallNext(false);
  }
  function wallTogglePause() {
    S.wall.paused = !S.wall.paused;
    wallSave();
    if (!S.wall.paused) WALL.shownAt = Date.now();
    toast(S.wall.paused ? 'Pozadina zadržana' : 'Izmjena pozadina nastavljena');
    if (S.zone === 'settings') renderSettings();
  }
  function wallApply() {
    stage.classList.toggle('wall-on', !!S.wall.on);
    shelfKey = ''; bgKey = '';
    updateShelf(true);
    if (!S.wall.on) { $('#wallA').classList.remove('on'); $('#wallB').classList.remove('on'); WALL.shownAt = 0; return; }
    if (WALL.cur && WALL.listSrc === S.wall.src && !WALL.shownAt) wallShow(WALL.cur);   // the last (or kept) one comes back first
    else if (!WALL.shownAt) wallNext(true);
  }
  setInterval(wallTick, 20000);

  /* ================= weather under the clock ================= */
  // Open-Meteo: free for personal use, no key. One request every half hour while Dom is on screen.
  var WX = { place: store.get('wxPlace', null), data: store.get('wxData', null), at: store.get('wxAt', 0), busy: false };
  var WX_ICON = {
    sun:   '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
    moon:  '<path d="M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z"/>',
    part:  '<circle cx="8" cy="8" r="3"/><path d="M8 2.2v1.6M2.2 8h1.6M3.9 3.9 5 5M12.1 3.9 11 5"/><path d="M8.5 19.5h8.7a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.5 1.3 3 3 0 0 0 .4 5.9z"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .5-8 5.6 5.6 0 0 0-10.7 1.5A3.3 3.3 0 0 0 7 18.5z"/>',
    fog:   '<path d="M7 14h10a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 7.9 8.1 3 3 0 0 0 7 14zM4 17.5h16M6.5 20.5h11"/>',
    rain:  '<path d="M7 14.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.5 1.3A3 3 0 0 0 7 14.5zM8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>',
    snow:  '<path d="M7 14.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.5 1.3A3 3 0 0 0 7 14.5z"/><path d="M8 18.2v.1M12 18.2v.1M16 18.2v.1M10 21v.1M14 21v.1" stroke-width="2.4"/>',
    storm: '<path d="M7 14.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.5 1.3A3 3 0 0 0 7 14.5z"/><path d="M12.8 15.5l-2.3 3.2h3l-2 3"/>'
  };
  function wxKind(code, day) {   // WMO weather codes
    if (code === 0) return [day ? 'sun' : 'moon', 'Vedro'];
    if (code === 1) return [day ? 'sun' : 'moon', 'Pretežno vedro'];
    if (code === 2) return ['part', 'Djelomično oblačno'];
    if (code === 3) return ['cloud', 'Oblačno'];
    if (code === 45 || code === 48) return ['fog', 'Magla'];
    if (code >= 51 && code <= 57) return ['rain', 'Rosulja'];
    if (code >= 61 && code <= 67) return ['rain', 'Kiša'];
    if (code >= 71 && code <= 77) return ['snow', 'Snijeg'];
    if (code >= 80 && code <= 82) return ['rain', 'Pljuskovi'];
    if (code === 85 || code === 86) return ['snow', 'Snježni pljuskovi'];
    if (code >= 95) return ['storm', 'Grmljavina'];
    return ['cloud', ''];
  }
  function wxRender() {
    var el = $('#weather'), d = WX.place && WX.data;
    // nothing rather than a stale reading
    if (!d || Date.now() - WX.at > 3 * 3600 * 1000) { el.innerHTML = ''; el.className = ''; stage.classList.remove('has-wx'); return; }
    stage.classList.add('has-wx');
    var k = wxKind(d.code, d.day);
    el.className = 'on';
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + WX_ICON[k[0]] + '</svg>' +
      '<span class="wx-t">' + Math.round(d.temp) + '°</span>' + (k[1] ? '<span class="wx-d">' + esc(k[1]) + '</span>' : '') +
      (d.max != null ? '<span class="wx-r">' + Math.round(d.max) + '° / ' + Math.round(d.min) + '°</span>' : '');
  }
  function wxRefresh(force) {
    if (!WX.place || WX.busy) return;
    if (!force && Date.now() - WX.at < 30 * 60000) return;
    if (DEMO) { WX.data = { temp: 9, code: 2, day: 0, max: 13, min: 5 }; WX.at = Date.now(); wxRender(); return; }
    WX.busy = true;
    getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + WX.place.lat + '&longitude=' + WX.place.lon +
      '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1').then(function (r) {
      var c = r && r.current, dl = (r && r.daily) || {};
      if (!c || typeof c.temperature_2m !== 'number') return;
      WX.data = { temp: c.temperature_2m, code: c.weather_code, day: c.is_day ? 1 : 0,
                  max: dl.temperature_2m_max ? dl.temperature_2m_max[0] : null, min: dl.temperature_2m_min ? dl.temperature_2m_min[0] : null };
      WX.at = Date.now();
      store.set('wxData', WX.data); store.set('wxAt', WX.at);
    }).catch(function () {}).then(function () { WX.busy = false; wxRender(); if (S.zone === 'settings') renderSettings(); });
  }
  function wxSetCity(name) {
    name = String(name || '').trim();
    if (!name) { toast('Upiši ime grada'); return; }
    var done = function (p) {
      WX.place = p; WX.data = null; WX.at = 0;
      store.set('wxPlace', p); store.set('wxData', null); store.set('wxAt', 0);
      SET.city = ''; SET.busy = false;
      wxRefresh(true); renderSettings();
    };
    if (DEMO) { done({ name: name, lat: 45.81, lon: 15.98 }); return; }
    SET.busy = true; renderSettings();
    getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&language=hr&format=json&name=' + encodeURIComponent(name)).then(function (r) {
      var g = r && r.results && r.results[0];
      if (!g) { SET.busy = false; toast('Ne nalazim "' + name + '"'); renderSettings(); return; }
      done({ name: g.name + (g.admin1 && g.admin1 !== g.name ? ', ' + g.admin1 : ''), lat: g.latitude, lon: g.longitude });
    }, function () { SET.busy = false; toast('Ne mogu do servisa za prognozu'); renderSettings(); });
  }
  function wxRows(rows) {
    rows.push({ h: 'Vremenska prognoza' });
    if (WX.place) {
      var d = WX.data;
      rows.push({ type: 'info', label: WX.place.name, value: d ? Math.round(d.temp) + '° · ' + (wxKind(d.code, d.day)[1] || '') : '…' });
      rows.push({ type: 'btn', name: 'wx-off', label: 'Ukloni prognozu', act: function () {
        WX.place = null; WX.data = null; store.set('wxPlace', null); store.set('wxData', null); wxRender(); renderSettings();
      } });
    } else {
      rows.push({ note: 'Upiši grad i ispod sata će se prikazivati trenutna temperatura i stanje.' });
    }
    rows.push({ type: 'input', name: 'city', label: WX.place ? 'Drugi grad' : 'Grad (npr. Zagreb)', inputType: 'text' });
    rows.push({ type: 'btn', name: 'wx-set', label: SET.busy ? 'Tražim…' : 'Postavi grad', act: function () { if (!SET.busy) wxSetCity(SET.city); } });
  }
  setInterval(function () { if (!document.hidden) wxRefresh(false); }, 5 * 60000);

  /* ================= tune (debloat + speed) ================= */
  var TUNE_GROUPS = [
    { key: 'track', label: 'Blokiraj praćenje i reklame' },
    { key: 'logs',  label: 'Manje sistemskih zapisa' },
    { key: 'voice', label: 'Ugasi glasovno upravljanje', warn: 'Mikrofon na daljinskom ne radi dok je ovo uključeno' },
    { key: 'iot',   label: 'Ugasi pametni dom i ThinQ', warn: 'ThinQ aplikacija i pametni uređaji ne vide TV dok je ovo uključeno' },
    { key: 'cast',  label: 'Ugasi AirPlay i zrcaljenje zaslona', warn: 'AirPlay, Miracast i Chromecast ne rade dok je ovo uključeno' },
    { key: 'tv',    label: 'Ugasi TV vodič (antena/kabel)', warn: 'Vodič i podsjetnici za TV kanale ne rade dok je ovo uključeno' },
    { key: 'zram',  label: 'Brža izmjena aplikacija (pokusno)', warn: 'Pokusno: ako TV postane nestabilan, isključi ovo ili restartaj TV' }
  ];
  function parseTune(out) {
    var m = /^track=\d.*$/m.exec(out || '');
    if (!m) return false;
    var t = {};
    m[0].split(/\s+/).forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) t[kv.slice(0, i)] = parseInt(kv.slice(i + 1), 10) || 0; });
    S.tune = t; S.tuneMissing = false;
    return true;
  }
  function loadTune() {
    if (DEMO) { if (!S.tune) S.tune = { track: 1, logs: 1, voice: 0, iot: 0, cast: 0, tv: 0, zram: 0, mem: 531, stopped: 5, safe: 0 }; return; }
    exec('/home/root/dom-tune.sh get', 15000).then(function (out) {
      if (!parseTune(out)) S.tuneMissing = true;
    }, function () { S.tuneMissing = true; }).then(function () { if (S.zone === 'settings') renderSettings(); });
  }
  function tuneSet(key, on) {
    if (DEMO) { S.tune[key] = on ? 1 : 0; S.tune.mem += on ? 20 : -20; renderSettings(); return; }
    S.tuneBusy = key; renderSettings();
    exec('/home/root/dom-tune.sh set ' + key + ' ' + (on ? 1 : 0), 90000).then(function (out) {
      if (!parseTune(out)) toast('Nije uspjelo');
    }, function () { toast('Nije uspjelo'); }).then(function () { S.tuneBusy = ''; if (S.zone === 'settings') renderSettings(); });
  }

  /* ================= settings ================= */
  var SET = { rows: [], pos: 0, email: '', password: '', city: '', busy: false };
  function wallRows(rows) {
    rows.push({ h: 'Pozadina' });
    if (S.wall.on) {
      rows.push({ type: 'btn', name: 'wall-pause', label: 'Zadrži trenutnu pozadinu', value: S.wall.paused ? 'Da' : 'Ne', act: wallTogglePause });
      rows.push({ type: 'btn', name: 'wall-next', label: 'Sljedeća pozadina', act: function () { wallNext(true); } });
    }
    rows.push({ type: 'toggle', name: 'wall-on', label: 'Pozadine s interneta', value: S.wall.on ? 'Uključeno' : 'Isključeno', off: !S.wall.on, act: function () {
      S.wall.on = !S.wall.on; wallSave(); wallApply(); renderSettings();
    } });
    if (S.wall.on) {
      rows.push({ type: 'btn', name: 'wall-mins', label: 'Izmjena svakih', value: (S.wall.mins >= 60 ? '1 h' : S.wall.mins + ' min') + '  ›', act: function () {
        S.wall.mins = WALL_MINS[(WALL_MINS.indexOf(S.wall.mins) + 1) % WALL_MINS.length]; wallSave(); renderSettings();
      } });
      rows.push({ type: 'btn', name: 'wall-src', label: 'Izvor slika', value: WALL_SRC[S.wall.src] + '  ›', act: function () {
        S.wall.src = WALL_SRC_ORDER[(WALL_SRC_ORDER.indexOf(S.wall.src) + 1) % WALL_SRC_ORDER.length];
        wallSave(); WALL.shownAt = 0; renderSettings(); wallNext(true);
      } });
      if (WALL.cur && WALL.cur.title) rows.push({ note: 'Sada: ' + WALL.cur.title + (WALL.cur.credit ? ' · ' + WALL.cur.credit : '') });
      else rows.push({ note: 'Slike su Full HD, koliko Dom može prikazati. Dok su pozadine uključene, snimke iz aplikacija se ne prikazuju.' });
    } else {
      rows.push({ note: 'Fotografije se izmjenjuju u pozadini umjesto snimki iz aplikacija.' });
    }
  }
  function settingsRows() {
    var rows = [];
    if (S.wall.on) wallRows(rows);   // on top while in use, so keeping a picture is two presses away
    rows.push({ h: 'Stremio' });
    if (S.authKey) {
      rows.push({ type: 'info', label: 'Prijavljen', value: S.stremioUser || 'da' });
      rows.push({ type: 'btn', label: 'Osvježi "Nastavi gledati"', value: S.cw.length + ' stavki', act: function () { refreshStremio(true).then(function () { toast('Osvježeno'); renderSettings(); }); } });
      rows.push({ type: 'btn', label: 'Odjavi se', act: function () {
        S.authKey = ''; S.stremioUser = ''; S.cw = []; store.set('authKey', ''); store.set('stremioUser', ''); store.set('cw', []);
        renderCards(); updateShelf(true); renderSettings();
      } });
    } else {
      rows.push({ note: 'Prijavi se svojim Stremio računom da launcher prikazuje što si zadnje gledao.' });
      rows.push({ type: 'input', name: 'email', label: 'Email', inputType: 'email' });
      rows.push({ type: 'input', name: 'password', label: 'Lozinka', inputType: 'password' });
      rows.push({ type: 'btn', label: SET.busy ? 'Prijavljujem…' : 'Prijavi se', act: doLogin });
    }
    rows.push({ h: 'Izgled' });
    rows.push({ type: 'btn', name: 'layout', label: 'Izgled početnog zaslona', value: L().name + '  ›', act: function () {
      S.layout = LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(S.layout) + 1) % LAYOUT_ORDER.length];
      store.set('layout', S.layout);
      applyLayout();
      renderSettings();
    } });
    if (!S.wall.on) wallRows(rows);
    wxRows(rows);
    rows.push({ h: 'Aplikacije' });
    rows.push({ note: 'Dugi pritisak na OK na ikoni pokreće premještanje. Ovdje možeš sakriti aplikacije.' });
    S.apps.forEach(function (a) {
      var hidden = S.hidden.indexOf(a.key) >= 0;
      rows.push({ type: 'toggle', app: a, label: a.title, value: hidden ? 'Skriveno' : 'Prikazano', off: hidden, act: function () {
        var i = S.hidden.indexOf(a.key);
        if (i >= 0) S.hidden.splice(i, 1); else S.hidden.push(a.key);
        store.set('hidden', S.hidden);
        buildList(); renderGrid(); renderSettings();
      } });
    });
    rows.push({ h: 'Čišćenje i ubrzanje' });
    if (!S.tune) {
      rows.push({ note: S.tuneMissing ? 'Nije instalirano. Ponovi instalaciju Doma pa otvori Postavke opet.' : 'Učitavam…' });
    } else {
      rows.push({ note: 'Slobodno memorije: ' + S.tune.mem + ' MB' + (S.tune.stopped ? ' · ugašeno servisa: ' + S.tune.stopped : '') +
        '. Ništa se ne briše: isključivanjem prekidača ili restartom TV-a sve se vraća.' +
        (S.tune.safe ? ' TV se dvaput zaredom ubrzo restartao pa je čišćenje pauzirano; uključi neki prekidač da ga vratiš.' : '') });
      TUNE_GROUPS.forEach(function (g) {
        var on = !!S.tune[g.key], busy = S.tuneBusy === g.key;
        rows.push({ type: 'toggle', name: 'tune-' + g.key, label: g.label, value: busy ? '…' : (on ? 'Uključeno' : 'Isključeno'), off: !on, act: function () {
          if (S.tuneBusy) return;
          if (!on && g.warn) toast(g.warn);
          tuneSet(g.key, !on);
        } });
      });
    }
    rows.push({ h: 'Sustav' });
    rows.push({ type: 'btn', name: 'domOnOff', label: 'Dom kao početni zaslon', value: S.disabled ? 'Isključeno' : 'Uključeno', act: function () {
      var off = !S.disabled;
      var done = function () {
        S.disabled = off;
        toast(off ? 'Dom je isključen: Home tipka otvara LG Home. Dom ostaje u popisu aplikacija.' : 'Dom je ponovno početni zaslon');
        renderSettings();
      };
      if (DEMO) done(); else exec('/home/root/dom-ctl.sh ' + (off ? 'off' : 'on'), 20000).then(done, function () { toast('Nije uspjelo — ponovi instalaciju'); });
    } });
    rows.push({ type: 'btn', label: 'Otvori originalni LG Home', act: function () {
      closeSettings();
      if (DEMO) { toast('Pokrećem: LG Home'); return; }
      // stay dark underneath: LG Home is a see-through overlay
      stage.classList.remove('instant'); stage.classList.add('leaving'); stage.classList.add('out');
      exec('/home/root/dom-ctl.sh lghome', 20000).catch(function () { fadeIn(true); toast('Ne mogu otvoriti LG Home'); });
    } });
    rows.push({ type: 'btn', label: 'Poništi redoslijed aplikacija', act: function () {
      S.order = []; store.set('order', []); buildList(); renderGrid(); toast('Redoslijed poništen'); renderSettings();
    } });
    rows.push({ type: 'btn', label: 'Obriši snimke pozadina', act: function () {
      var done = function () { S.apps.forEach(function (a) { a.shot = ''; }); reloadApps().then(function () { updateShelf(true); toast('Snimke obrisane'); }); };
      if (DEMO) done(); else exec('rm -f /home/root/dom-shots/*').then(done, done);
    } });
    rows.push({ type: 'btn', label: 'Ponovno učitaj aplikacije', act: function () { reloadApps().then(function () { toast('Učitano'); renderSettings(); }); } });
    return rows;
  }
  function renderSettings() {
    var rowId = function (r) { return r ? (r.app ? 'app:' + r.app.key : (r.name ? 'in:' + r.name : '')) : ''; };
    var prevName = rowId(SET.rows[(SET.focusables || [])[SET.pos]]);
    SET.rows = settingsRows();
    var html = '<div id="settings-scroll">';
    var focusables = [];
    SET.rows.forEach(function (r, i) {
      if (r.h) { html += '<div class="s-h">' + esc(r.h) + '</div>'; return; }
      if (r.note) { html += '<div class="s-note">' + esc(r.note) + '</div>'; return; }
      focusables.push(i);
      if (r.type === 'input') {
        html += '<div class="s-row s-input" data-i="' + i + '"><input type="' + r.inputType + '" placeholder="' + esc(r.label) +
          '" value="' + esc(SET[r.name]) + '" data-name="' + r.name + '"></div>';
      } else {
        var icon = r.app && r.app.icon ? '<img src="' + esc(r.app.icon) + '" alt="">' : '';
        html += '<div class="s-row' + (r.off ? ' off' : '') + '" data-i="' + i + '"><div class="s-left">' + icon + '<span>' + esc(r.label) +
          '</span></div>' + (r.value ? '<div class="s-val">' + esc(r.value) + '</div>' : '') + '</div>';
      }
    });
    html += '</div>';
    $('#settings-body').innerHTML = html;
    SET.focusables = focusables;
    // keep focus on the same row if possible
    if (prevName) focusables.forEach(function (ri, p) { if (rowId(SET.rows[ri]) === prevName) SET.pos = p; });
    SET.pos = Math.max(0, Math.min(SET.pos || 0, focusables.length - 1));
    var inputs = document.querySelectorAll('#settings-body input');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('input', function (ev) { SET[ev.target.dataset.name] = ev.target.value; });
    }
    var rowsEl = document.querySelectorAll('#settings-body .s-row');
    for (var m = 0; m < rowsEl.length; m++) {
      (function (el, p) {
        el.addEventListener('mouseenter', function () { if (!pointerMoved()) return; SET.pos = p; settingsFocus(false); });
        el.addEventListener('click', function () { SET.pos = p; settingsFocus(false); settingsOk(); });
      })(rowsEl[m], m);
    }
    settingsFocus(false);
  }
  function settingsFocus(enterInput) {
    var els = document.querySelectorAll('#settings-body .s-row');
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('focus', i === SET.pos);
    var el = els[SET.pos];
    if (!el) return;
    // scroll
    var body = $('#settings-body'), scroll = $('#settings-scroll');
    var top = el.offsetTop, h = body.clientHeight;
    var cur = -(parseFloat((scroll.style.transform || '').replace(/[^-\d.]/g, '')) || 0);
    if (top - 80 < cur) cur = Math.max(0, top - 80);
    else if (top + el.offsetHeight + 40 > cur + h) cur = top + el.offsetHeight + 40 - h;
    scroll.style.transform = 'translateY(' + (-cur) + 'px)';
    var input = el.querySelector('input');
    if (input && enterInput) input.focus();
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  }
  function settingsOk() {
    var r = SET.rows[SET.focusables[SET.pos]];
    if (!r) return;
    if (r.type === 'input') settingsFocus(true);
    else if (r.act) r.act();
  }
  function settingsKey(e) {
    var k = e.keyCode;
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (inInput && k !== KEY.UP && k !== KEY.DOWN && k !== KEY.BACK && k !== KEY.OK) return; // let the keyboard type
    if (k === KEY.UP) { if (SET.pos > 0) { SET.pos--; settingsFocus(false); } }
    else if (k === KEY.DOWN) { if (SET.pos < SET.focusables.length - 1) { SET.pos++; settingsFocus(false); } }
    else if (k === KEY.OK) {
      if (inInput) { document.activeElement.blur(); if (SET.pos < SET.focusables.length - 1) SET.pos++; settingsFocus(false); }
      else settingsOk();
    } else if (k === KEY.BACK || k === KEY.ESC || (k === KEY.BKSP && !inInput)) {
      if (inInput) document.activeElement.blur(); else closeSettings();
    } else return;
    e.preventDefault();
  }
  function doLogin() {
    if (SET.busy) return;
    if (!SET.email || !SET.password) { toast('Upiši email i lozinku'); return; }
    SET.busy = true; renderSettings();
    stremioLogin(SET.email, SET.password).then(function () {
      SET.busy = false; SET.password = ''; SET.pos = 0;
      toast('Prijavljen u Stremio');
      renderSettings(); renderCards(); updateShelf(true);
    }).catch(function (e) {
      SET.busy = false; toast(e.message || 'Prijava nije uspjela'); renderSettings();
    });
  }
  function openSettings() {
    S.zone = 'settings';
    SET.pos = 0; SET.rows = [];
    loadTune();
    renderSettings();
    $('#settings').classList.remove('hidden');
    applyFocus();
  }
  function closeSettings() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    $('#settings').classList.add('hidden');
    S.zone = 'grid';
    applyFocus();
    updateShelf(true);
  }

  /* ================= misc ================= */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2800);
  }
  function tickClock() {
    var d = new Date();
    $('#clock').textContent = d.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
    var ds = d.toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase();
    $('#date').textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
    var h = d.getHours();
    $('#greet').textContent = h >= 5 && h < 12 ? 'Dobro jutro' : (h >= 12 && h < 18 ? 'Dobar dan' : 'Dobra večer');
  }
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'translate(' + ((window.innerWidth - 1920 * s) / 2) + 'px,' + ((window.innerHeight - 1080 * s) / 2) + 'px) scale(' + s + ')';
  }
  var reloading = null;
  function reloadApps() {
    if (reloading) return reloading;   // relaunch + visibility events arrive together
    reloading = loadApps().then(function (apps) {
      reloading = null;
      S.apps = apps;
      if (!DEMO) store.set('appsCache', apps);
      if (S.moving) return;            // don't reshuffle under the user's hands
      var cur = S.list[S.idx] && S.list[S.idx].key;
      buildList();
      for (var i = 0; i < S.list.length; i++) if (S.list[i].key === cur) S.idx = i;
      if (tileSig(S.list) !== gridSig) renderGrid(); else applyFocus();
      updateShelf();
    }).catch(function (e) {
      reloading = null;
      if (!S.apps.length) toast('Ne mogu učitati aplikacije: ' + e.message);
    });
    return reloading;
  }
  // handlesRelaunch=true: the TV only brings us to the front after activate()
  function bringToFront() {
    try {
      if (window.webOSSystem && window.webOSSystem.activate) window.webOSSystem.activate();
      else if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate();
    } catch (e) {}
  }
  // returning from an app: start black and fade in, so the hand-over reads as a transition
  var lastFade = 0;
  function fadeOutNow() { stage.classList.add('instant'); stage.classList.add('out'); }
  // Going to an app: fade to black while we are still on screen, so black is the
  // last frame the TV keeps of us (otherwise the old screen flashes on return).
  function leaving() {
    stage.classList.remove('instant');
    stage.classList.add('leaving'); stage.classList.add('out');
    // the app never covered us (failed, or it's an overlay): come back
    setTimeout(function () { if (!document.hidden && stage.classList.contains('leaving')) fadeIn(true); }, 4000);
  }
  function fadeIn(force) {
    if (!force && Date.now() - lastFade < 800) return;
    lastFade = Date.now();
    stage.classList.remove('leaving');
    fadeOutNow();
    void stage.offsetWidth;
    var go = function () { stage.classList.remove('instant'); void stage.offsetWidth; stage.classList.remove('out'); };
    if (window.requestAnimationFrame) requestAnimationFrame(go); else go();
    setTimeout(go, 150);   // in case no frame is produced
  }
  // Do the heavy refreshing after the fade, so the animation isn't competing with it.
  var refreshTimer;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (!DEMO) exec('rm -f /tmp/dom-allow-home; [ -f /var/lib/webosbrew/init.d/06-dom-blank-home ] && [ -x /home/root/dom-blank-home.sh ] && /home/root/dom-blank-home.sh on').catch(function () {});
      reloadApps();
      refreshStremio(false);
      refreshAppContents(false);
    }, 1050);
  }
  var wasAway = false;
  function onShow() {
    bringToFront();
    var back = wasAway || stage.classList.contains('out');
    wasAway = false;
    if (S.zone === 'settings') closeSettings();
    if (S.moving) endMove();
    S.zone = 'grid';
    // coming back from an app: stay on its tile (nothing jumps during the fade);
    // Home pressed while already here: go to the first tile
    if (back) applyFocus(); else setIdx(0);
    fadeIn();
    refreshSoon();
  }

  /* ================= demo data (browser preview) ================= */
  function demoApps() {
    var list = [
      ['Stremio', '#5b3fd6'], ['Netflix', '#b20710'], ['YouTube', '#d40000'], ['Disney+', '#0b2a6b'], ['Max', '#2b2bdb'],
      ['Prime Video', '#0f79af'], ['Spotify', '#1a9f4a'], ['Jellyfin', '#6b3fa0'], ['Live TV', '#3a3a3c'], ['HDMI 1', '#48484a'],
      ['Twitch', '#6441a5'], ['Apple TV', '#1c1c1e'], ['Plex', '#c98a00'], ['Web preglednik', '#2a6fdb']
    ];
    return list.map(function (x, i) { return { key: 'demo' + i, id: 'demo.' + i, title: x[0], icon: '', color: x[1], bg: '', params: {} }; });
  }
  function demoCW() {
    return [
      { id: 'tt11280740', type: 'series', name: 'Severance', videoId: 'tt11280740:2:7', season: 2, episode: 7, offset: 1560000, duration: 3120000 },
      { id: 'tt14452776', type: 'series', name: 'The Bear', videoId: 'tt14452776:3:4', season: 3, episode: 4, offset: 600000, duration: 1800000 },
      { id: 'tt15239678', type: 'movie', name: 'Dune: Part Two', videoId: 'tt15239678', season: 0, episode: 0, offset: 5400000, duration: 9960000 },
      { id: 'tt2788316', type: 'series', name: 'Shōgun', videoId: 'tt2788316:1:9', season: 1, episode: 9, offset: 300000, duration: 3500000 },
      { id: 'tt0903747', type: 'series', name: 'Breaking Bad', videoId: 'tt0903747:5:14', season: 5, episode: 14, offset: 2400000, duration: 2820000 }
    ].map(function (x) {
      var item = mapItemFromDemo(x);
      return item;
    });
  }
  function mapItemFromDemo(x) {
    return mapItem({ _id: x.id, type: x.type, name: x.name, poster: '', state: { video_id: x.videoId, timeOffset: x.offset, duration: x.duration } });
  }

  /* ================= boot ================= */
  window.addEventListener('resize', fit);
  document.addEventListener('webOSRelaunch', onShow);
  document.addEventListener('visibilitychange', function () { okHeld = false; clearTimeout(okTimer); if (document.hidden) { wasAway = true; fadeOutNow(); } else { fadeIn(); refreshSoon(); wallTick(); wxRender(); wxRefresh(false); } });
  fit();
  applyLayout();
  wallApply();
  wxRender(); wxRefresh(false);
  fadeIn();
  tickClock();
  setInterval(tickClock, 10000);
  preloadCW(S.cw);
  preloadCW([].concat.apply([], Object.keys(S.appRows).map(function (k) { return S.appRows[k]; })));
  // show the last known apps immediately; the fresh list replaces them if anything changed
  var cachedApps = DEMO ? null : store.get('appsCache', null);
  if (cachedApps && cachedApps.length) { S.apps = cachedApps; buildList(); renderGrid(); drawShelf(); }
  reloadApps().then(function () { refreshStremio(true); refreshAppContents(true); });
  setInterval(function () { if (!document.hidden) { refreshStremio(false); refreshAppContents(false); } }, 5 * 60 * 1000);
})();
