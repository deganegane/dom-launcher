/* Dom — Apple TV style launcher for rooted LG webOS TVs */
(function () {
  'use strict';

  var APP_ID = 'com.deganegane.dom';
  var HB_EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
  var AM = 'luna://com.webos.applicationManager';
  var STREMIO_API = 'https://api.strem.io/api/';
  var DEMO = typeof window.PalmServiceBridge === 'undefined';
  var COLS = 5;
  var ROW_H = 180 + 92;
  var SETTINGS_KEY = '__settings';
  var BOOT = Date.now();

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
  function luna(uri, params) {
    if (DEMO) return Promise.reject(new Error('demo'));
    return lunaDirect(uri, params).catch(function () {
      return exec('luna-send -n 1 -w 8000 ' + uri + ' ' + shq(JSON.stringify(params || {}))).then(function (out) {
        var r = JSON.parse(out.trim());
        if (r.returnValue === false) throw new Error(r.errorText || 'Greška');
        return r;
      });
    });
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
    authKey: store.get('authKey', ''),
    stremioUser: store.get('stremioUser', ''),
    zone: 'grid',             // grid | shelf | settings
    idx: 0, card: 0, moving: false,
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
          title: lp.title || lp.id,
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
      var names = [a.id, a.title].filter(Boolean).map(shq).join(' ');
      cmds.push('for n in ' + names + '; do for e in jpg jpeg png webp; do if [ -f "$B/$n.$e" ]; then cp -f "$B/$n.$e" "$D/' + base + '.$e" && echo "CUSTOM|' + a.key.replace(/[|'"\\$`]/g, '') + '|' + base + '.$e"; break 2; fi; done; done');
    });
    // own icons: /home/root/dom-icons/<app id or title>.png|jpg|webp
    cmds.push('I=/home/root/dom-icons');
    apps.forEach(function (a) {
      var base = a.key.replace(/[^A-Za-z0-9._-]/g, '_') + '_icon';
      var names = [a.id, a.title].filter(Boolean).map(shq).join(' ');
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
    cmds.push('echo ok');
    return exec(cmds.join('; '), 30000).then(function (out) {
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
      var v = '?v=' + BOOT;
      apps.forEach(function (a) { if (a.customIcon) { a.fallbackIcon = a.icon; a.icon = a.customIcon; a.iconDirect = ''; } });
      apps.forEach(function (a) { if (/^cache\//.test(a.icon)) a.icon += v; if (/^cache\//.test(a.bg)) a.bg += v; });
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
    luna(AM + '/launch', { id: app.id, params: params }).catch(function (e) { toast('Ne mogu pokrenuti ' + app.title + ': ' + e.message); });
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
        .map(function (x) { return { id: x.id, s: x.season, e: x.episode || x.number, r: Date.parse(x.released) }; });
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
        S.cw = items;
        store.set('cw', items);
        preloadCW(items);
        renderCards();
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
    exec('luna-send -n 1 luna://com.webos.service.applicationManager/closeByAppId ' + shq(JSON.stringify({ id: app.id })) + ' >/dev/null 2>&1; sleep 1; ' +
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
        if (ci < 9 && cj < 9) continue;          // skip rounded corners               // a ring just inside the edge (skips rounded corners' outer pixels)
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
  function renderGrid() {
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
          var done = function (look) {
            // canvas unavailable: custom icons carry their own background, show them edge to edge
            if (!look && a.customIcon) look = { mode: 'photo' };
            if (!look) return;
            applyLook(el, look);
            iconLooks[iconKey(a.icon)] = look;
            clearTimeout(saveLooksTimer);
            saveLooksTimer = setTimeout(function () { store.set('iconLooks3', iconLooks); }, 1500);
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
    S.cw.slice(0, 6).forEach(function (item, i) {
      var el = document.createElement('div');
      el.className = 'card';
      var pct = item.duration ? Math.min(100, Math.round(item.offset / item.duration * 100)) : 0;
      el.innerHTML = '<div class="card-title">' + esc(item.name) + (item.season ? ' · S' + item.season + 'E' + item.episode : '') + '</div>' +
        '<div class="card-bar"><div style="width:' + pct + '%"></div></div>';
      setImage(el, [item.thumb, item.thumbFallback, item.poster]);
      el.addEventListener('mouseenter', function () { if (!pointerMoved()) return; if (S.zone !== 'settings') { S.zone = 'shelf'; S.card = i; applyFocus(); updateShelf(); } });
      el.addEventListener('click', function () { playCW(item); });
      c.appendChild(el);
    });
    if (S.card >= S.cw.length) S.card = Math.max(0, Math.min(5, S.cw.length - 1));
  }
  // set background-image using the first URL that actually loads
  function setImage(el, urls, onDone) {
    urls = urls.filter(Boolean);
    (function next(i) {
      if (i >= urls.length) { if (onDone) onDone(false); return; }
      var im = new Image();
      im.onload = function () { el.style.backgroundImage = 'url("' + urls[i] + '")'; if (onDone) onDone(true); };
      im.onerror = function () { next(i + 1); };
      im.src = urls[i];
    })(0);
  }

  /* ---------- background ---------- */
  var bgFront = 'A', bgKey = '';
  function setBackground(key, urls, blurredFallback) {
    if (key === bgKey) return;
    bgKey = key;
    var back = bgFront === 'A' ? 'B' : 'A';
    var layer = $('#bg' + back), img = layer.querySelector('.bg-img');
    img.className = 'bg-img';
    img.style.backgroundImage = '';
    img.style.backgroundColor = '#111';
    var show = function () {
      if (bgKey !== key) return;
      layer.classList.add('on');
      $('#bg' + bgFront).classList.remove('on');
      bgFront = back;
    };
    setImage(img, urls, function (ok) {
      if (!ok) {
        if (blurredFallback && blurredFallback.ambient) img.style.backgroundImage = blurredFallback.ambient;
        img.style.backgroundColor = (blurredFallback && blurredFallback.color) || '#0b0b0d';
      }
      show();
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
    var t = (a.title || '') + ' ' + (a.id || '');
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
    var showCards = isStremio(a) && S.cw.length > 0;
    shelf.classList.toggle('has-cards', showCards);

    var key, info;
    if (showCards) {
      var item = S.cw[S.zone === 'shelf' ? S.card : 0];
      key = 'cw:' + item.id + ':' + item.videoId;
      info = {
        kicker: 'Nastavi gledati', title: item.name, logo: item.logo, sub: itemSub(item),
        progress: item.duration ? item.offset / item.duration : -1,
        bg: [item.backdrop, item.poster], fb: { color: '#202024' }
      };
    } else if (a && a.key === SETTINGS_KEY) {
      key = 'settings';
      info = { kicker: '', title: 'Postavke', sub: 'Stremio račun, skrivanje aplikacija i ostalo', progress: -1, bg: [], fb: { color: '#26262a' } };
    } else if (a) {
      key = 'app:' + a.key + (consoleOf(a) ? '' : (a.shot || ''));
      var sub = isStremio(a) ? (S.authKey ? 'Nema ničega za nastaviti' : 'Prijavi se u Postavkama za "Nastavi gledati"') : '';
      info = { kicker: '', title: a.title, sub: sub, progress: -1, bg: consoleOf(a) ? [a.custom ? a.bg : ''] : [a.shot, a.bg], fb: { ambient: ambientFor(a) } };
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
  function rowOf(i) { return Math.floor(i / COLS); }
  function applyFocus() {
    var tiles = document.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.toggle('focus', S.zone === 'grid' && i === S.idx);
      tiles[i].classList.toggle('moving', S.moving && i === S.idx);
    }
    var cards = document.querySelectorAll('.card');
    for (var j = 0; j < cards.length; j++) cards[j].classList.toggle('focus', S.zone === 'shelf' && j === S.card);

    var r = rowOf(S.idx);
    var y = (S.zone === 'shelf' || r === 0) ? 0 : (430 - 640 - r * ROW_H);
    $('#grid').style.transform = 'translateY(' + y + 'px)';
    stage.classList.toggle('scrolled', S.zone !== 'shelf' && r > 0);
    stage.classList.toggle('zone-shelf', S.zone === 'shelf');
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
    if (S.zone === 'settings') { settingsKey(e); return; }
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
      else if (k === KEY.UP) moveTile(-COLS);
      else if (k === KEY.DOWN) moveTile(COLS);
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) endMove();
      return;
    }
    if (S.zone === 'grid') {
      var col = S.idx % COLS;
      if (k === KEY.LEFT && col > 0) setIdx(S.idx - 1, 'left');
      else if (k === KEY.RIGHT && col < COLS - 1 && S.idx + 1 < S.list.length) setIdx(S.idx + 1, 'right');
      else if (k === KEY.DOWN) {
        if (S.idx + COLS < S.list.length) setIdx(S.idx + COLS, 'down');
        else if (rowOf(S.list.length - 1) > rowOf(S.idx)) setIdx(S.list.length - 1, 'down');
        else nudge('down');
      } else if (k === KEY.UP) {
        if (rowOf(S.idx) > 0) setIdx(S.idx - COLS, 'up');
        else if (isStremio(S.list[S.idx]) && S.cw.length) { S.zone = 'shelf'; S.card = 0; applyFocus(); updateShelf(); }
        else nudge('up');
      } else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) { S.zone = 'grid'; setIdx(0); }
      else return;
      e.preventDefault();
      return;
    }
    if (S.zone === 'shelf') {
      var n = Math.min(6, S.cw.length);
      if (k === KEY.LEFT && S.card > 0) { S.card--; applyFocus(); updateShelf(); }
      else if (k === KEY.RIGHT && S.card < n - 1) { S.card++; applyFocus(); updateShelf(); }
      else if (k === KEY.DOWN || k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) { S.zone = 'grid'; applyFocus(); updateShelf(); }
      else return;
      e.preventDefault();
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
    if (e.keyCode !== KEY.OK || S.zone === 'settings') return;
    okHeld = false;
    clearTimeout(okTimer);
    if (okLong) return;
    if (S.moving) { endMove(); return; }
    if (S.zone === 'grid') activate();
    else if (S.zone === 'shelf' && S.cw[S.card]) playCW(S.cw[S.card]);
  });

  /* ================= settings ================= */
  var SET = { rows: [], idx: 0, email: '', password: '', busy: false };
  function settingsRows() {
    var rows = [];
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
    rows.push({ h: 'Sustav' });
    rows.push({ type: 'btn', label: 'Otvori originalni LG Home', act: function () {
      closeSettings();
      var go = function () { launch({ id: 'com.webos.app.home', title: 'LG Home', params: {} }); };
      if (DEMO) go(); else exec('touch /tmp/dom-allow-home').then(go, go);
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
    var prevName = SET.rows[SET.idx] && (SET.rows[SET.idx].label + (SET.rows[SET.idx].name || ''));
    SET.rows = settingsRows().filter(function (r) { return true; });
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
    var pos = 0;
    focusables.forEach(function (ri, p) { var r = SET.rows[ri]; if ((r.label + (r.name || '')) === prevName) pos = p; });
    SET.pos = Math.min(SET.pos != null && !prevName ? SET.pos : pos, focusables.length - 1);
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
  }
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'translate(' + ((window.innerWidth - 1920 * s) / 2) + 'px,' + ((window.innerHeight - 1080 * s) / 2) + 'px) scale(' + s + ')';
  }
  function reloadApps() {
    return loadApps().then(function (apps) {
      S.apps = apps;
      buildList();
      renderGrid();
      updateShelf(true);
    }).catch(function (e) {
      toast('Ne mogu učitati aplikacije: ' + e.message);
    });
  }
  // handlesRelaunch=true: the TV only brings us to the front after activate()
  function bringToFront() {
    try {
      if (window.webOSSystem && window.webOSSystem.activate) window.webOSSystem.activate();
      else if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate();
    } catch (e) {}
  }
  function onShow() {
    bringToFront();
    if (S.zone === 'settings') closeSettings();
    if (S.moving) endMove();
    S.zone = 'grid';
    setIdx(0);
    reloadApps();
    refreshStremio(false);
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
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshStremio(false); reloadApps(); } });
  fit();
  tickClock();
  setInterval(tickClock, 10000);
  preloadCW(S.cw);
  renderCards();
  reloadApps().then(function () { refreshStremio(true); });
  setInterval(function () { if (!document.hidden) refreshStremio(false); }, 5 * 60 * 1000);
})();
