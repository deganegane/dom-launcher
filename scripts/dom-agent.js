// Dom background helper, runs as root next to the home guard:
//  - phone page: a small web server on the local network (only while /home/root/dom-web-on exists)
//  - consoles: watches the HDMI inputs and tells Dom when a PlayStation, Xbox or Switch comes on
//  - new episodes: asks Stremio every half hour and shows a TV notice, whatever is on screen
//    (only while /home/root/dom-notify-on exists)
// Plain Node, no modules.  Log: /tmp/dom-agent.log
'use strict';
var http = require('http');
var fs = require('fs');
var cp = require('child_process');
var os = require('os');
var crypto = require('crypto');

var APPID = 'com.deganegane.dom';
var ROOT = '/home/root';
var PORT = 8090;
var LOG = '/tmp/dom-agent.log';
var NODE = process.execPath;

/* ---------------- basics ---------------- */
try {   // one copy only
  var old = parseInt(fs.readFileSync('/tmp/dom-agent.pid', 'utf8'), 10);
  if (old && old !== process.pid) { process.kill(old, 0); console.log('already running'); process.exit(0); }
} catch (e) {}
fs.writeFileSync('/tmp/dom-agent.pid', String(process.pid));
process.on('exit', function () { try { if (fs.readFileSync('/tmp/dom-agent.pid', 'utf8') === String(process.pid)) fs.unlinkSync('/tmp/dom-agent.pid'); } catch (e) {} });
process.on('SIGTERM', function () { process.exit(0); });
process.on('uncaughtException', function (e) { log('error ' + (e && e.stack || e)); });

var logLines = 0;
function log(msg) {
  var line = new Date().toTimeString().slice(0, 8) + ' ' + msg + '\n';
  try {
    if (++logLines > 400) { logLines = 0; var t = fs.readFileSync(LOG, 'utf8').split('\n'); fs.writeFileSync(LOG, t.slice(-150).join('\n')); }
    fs.appendFileSync(LOG, line);
  } catch (e) {}
}
function has(name) { try { fs.statSync(ROOT + '/' + name); return true; } catch (e) { return false; } }
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; } }
function lunaSend(uri, params, cb) {
  cp.execFile('luna-send', ['-n', '1', '-w', '6000', uri, JSON.stringify(params || {})], { timeout: 9000 }, function (err, out) { if (cb) cb(err, out); });
}
function launchDom(params) { lunaSend('luna://com.webos.applicationManager/launch', { id: APPID, params: params }); }
function foreground() { return read('/tmp/dom-fg').trim(); }
function tvToast(msg) {
  lunaSend('luna://com.webos.notification/createToast', { sourceId: APPID, message: msg, onclick: { appId: APPID } }, function (err, out) {
    if (err || /"returnValue"\s*:\s*false/.test(out || '')) log('toast failed: ' + (out || err));
  });
}
// a subscription that keeps itself alive: onLine gets each JSON reply
function subscribe(uri, params, onLine) {
  var p = cp.spawn('luna-send', ['-i', uri, JSON.stringify(params)]), buf = '';
  p.stdout.on('data', function (d) {
    buf += d;
    var i;
    while ((i = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      var j = null; try { j = JSON.parse(line); } catch (e) {}
      if (j) onLine(j, line);
    }
  });
  p.on('exit', function () { setTimeout(function () { subscribe(uri, params, onLine); }, 5000); });
  p.on('error', function (e) { log('subscribe ' + uri + ': ' + e.message); });
}
// HTTPS through curl: the TV's own certificates and DNS work-arounds apply, and no TLS code is needed here
function curlJSON(url, body, cb) {
  var args = ['-s', '-m', '25', url];
  if (body) args.push('-X', 'POST', '-H', 'content-type: application/json', '--data', JSON.stringify(body));
  cp.execFile('curl', args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, function (err, out) {
    if (err) return cb(err);
    var j; try { j = JSON.parse(out); } catch (e) { return cb(e); }
    cb(null, j);
  });
}

/* ---------------- consoles on HDMI ---------------- */
var CONSOLE_RE = /ps5|ps4|playstation|xbox|nintendo|switch/i;
var inputs = null, inputLog = 0;
function consoleMode() { return read(ROOT + '/dom-console-mode').trim() || 'ask'; }
function watchInputs() {
  subscribe('luna://com.webos.service.eim/getAllInputStatus', { subscribe: true }, function (j, line) {
    if (inputLog < 15) { inputLog++; try { fs.appendFileSync('/tmp/dom-inputs.log', line + '\n'); } catch (e) {} }
    var devs = j.devices || j.inputs || [];
    if (!devs.length) return;
    var now = {};
    devs.forEach(function (d) {
      var id = d.id || d.inputId || d.deviceId;
      if (!id) return;
      // "connected" is true while something with a picture is on that input
      now[id] = { on: d.connected === true && d.hdmiPlugIn !== false, label: d.label || d.deviceName || d.name || '', app: d.appId || '', port: d.port };
    });
    if (inputs) {
      Object.keys(now).forEach(function (id) {
        var n = now[id], o = inputs[id];
        if (!n.on || (o && o.on)) return;
        var app = n.app || (n.port ? 'com.webos.app.hdmi' + n.port : '');
        if (!CONSOLE_RE.test(n.label + ' ' + id) || !app) return;
        var mode = consoleMode();
        log('console on: ' + n.label + ' (' + id + '), mode ' + mode + ', on screen ' + foreground());
        if (mode === 'off' || foreground() !== APPID) return;   // never interrupt something that is playing
        launchDom({ dom: 'console', appId: app, label: n.label });
      });
    }
    inputs = now;
  });
}

/* ---------------- new episodes ---------------- */
var NOTIFIED = ROOT + '/dom-notified.json';
function checkEpisodes() {
  if (!has('dom-notify-on')) return;
  var key = read(ROOT + '/dom-stremio-auth').trim();
  if (!key) return;
  curlJSON('https://api.strem.io/api/datastoreGet', { authKey: key, collection: 'libraryItem', ids: [], all: true }, function (err, r) {
    if (err || !r || !r.result) { log('stremio: ' + (err ? err.message : JSON.stringify(r && r.error))); return; }
    // the same series Stremio itself would put a "new episode" mark on
    var cands = r.result.filter(function (it) {
      var st = it.state || {};
      return it.type === 'series' && !it.removed && !it.temp && !st.noNotif && /^tt\d+$/.test(it._id || '') && st.lastWatched;
    }).sort(function (a, b) { return Date.parse(b._mtime || 0) - Date.parse(a._mtime || 0); }).slice(0, 20);
    var seen = null;
    try { seen = JSON.parse(read(NOTIFIED)); } catch (e) {}
    var first = !seen;
    seen = seen || {};
    var now = Date.now(), shown = 0, i = 0;
    (function next() {
      if (i >= cands.length) {
        var keep = {};
        Object.keys(seen).forEach(function (k) { if (now - seen[k] < 90 * 86400000) keep[k] = seen[k]; });
        fs.writeFileSync(NOTIFIED, JSON.stringify(keep));
        if (first) log('episodes: first run, ' + Object.keys(keep).length + ' marked as known');
        return;
      }
      var it = cands[i++], since = Date.parse(it.state.lastWatched);
      curlJSON('https://v3-cinemeta.strem.io/meta/series/' + it._id + '.json', null, function (e2, m) {
        var vids = (!e2 && m && m.meta && m.meta.videos) || [];
        vids.forEach(function (v) {
          var rel = Date.parse(v.released || '');
          if (!v.id || !(v.season > 0) || !(rel > since) || rel > now || seen[v.id]) return;
          seen[v.id] = now;
          if (first || shown >= 3) return;
          shown++;
          log('new episode: ' + it.name + ' ' + v.id);
          tvToast('Nova epizoda: ' + it.name + ' · S' + v.season + ' E' + (v.episode || v.number || '?'));
        });
        setTimeout(next, 300);
      });
    })();
  });
}

/* ---------------- phone page ---------------- */
var server = null, token = '';
function myIp() {
  var ifs = os.networkInterfaces(), best = '';
  Object.keys(ifs).forEach(function (n) {
    (ifs[n] || []).forEach(function (a) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && (!best || /^(wlan|eth)/.test(n))) best = a.address;
    });
  });
  return best;
}
function webState() {
  var on = !!server, ip = myIp();
  var st = { on: on, url: on && ip ? 'http://' + ip + ':' + PORT + '/#k=' + token : '' };
  try { fs.writeFileSync('/tmp/dom-web.json', JSON.stringify(st)); } catch (e) {}
}
function appDir() {
  var c = ['/media/developer/apps/usr/palm/applications/' + APPID, '/media/cryptofs/apps/usr/palm/applications/' + APPID];
  for (var i = 0; i < c.length; i++) { try { fs.statSync(c[i]); return c[i]; } catch (e) {} }
  return c[0];
}
function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, max, cb) {
  var chunks = [], size = 0, done = false;
  req.on('data', function (d) {
    size += d.length;
    if (size > max) { if (!done) { done = true; cb(new Error('too big')); } req.destroy(); return; }
    chunks.push(d);
  });
  req.on('end', function () { if (!done) { done = true; cb(null, Buffer.concat(chunks)); } });
  req.on('error', function (e) { if (!done) { done = true; cb(e); } });
}
var KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'HOME', 'EXIT', 'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FASTFORWARD',
  'VOLUMEUP', 'VOLUMEDOWN', 'MUTE', 'CHANNELUP', 'CHANNELDOWN', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'MENU', 'INFO'];
var IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// a file name from an app id or title: no path, nothing hidden
function safeName(n) { n = String(n || '').replace(/[\/\\\0]/g, '').trim(); return n && n.charAt(0) !== '.' && n.length < 120 ? n : ''; }

function handle(req, res) {
  var u = require('url').parse(req.url, true), p = u.pathname;
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    var page = read(ROOT + '/dom-web.html');
    return send(res, page ? 200 : 404, page || 'dom-web.html nedostaje', 'text/html; charset=utf-8');
  }
  var k = req.headers['x-dom-key'] || u.query.k || '';
  if (!token || k !== token) return send(res, 403, { error: 'Pogrešan kod' });

  if (req.method === 'GET' && p === '/api/state') {
    var st = {}; try { st = JSON.parse(read('/tmp/dom-state.json')); } catch (e) {}
    st.fg = foreground();
    st.keys = has('dom-ssap-key');
    return send(res, 200, st);
  }
  var icon = /^\/icon\/([A-Za-z0-9._-]+)$/.exec(p);
  if (req.method === 'GET' && icon) {
    fs.readFile(appDir() + '/cache/' + icon[1], function (err, data) {
      if (err) return send(res, 404, '');
      send(res, 200, data, /\.png$/.test(icon[1]) ? 'image/png' : /\.webp$/.test(icon[1]) ? 'image/webp' : 'image/jpeg');
    });
    return;
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'nema' });

  if (p === '/api/upload') {
    var kind = u.query.kind === 'icon' ? 'dom-icons' : (u.query.kind === 'bg' ? 'dom-backgrounds' : '');
    var name = safeName(u.query.name), ext = IMG_EXT[String(req.headers['content-type'] || '').split(';')[0]];
    if (!kind || !name || !ext) return send(res, 400, { error: 'Slika mora biti JPG, PNG ili WebP' });
    return readBody(req, 15 * 1024 * 1024, function (err, body) {
      if (err || !body.length) return send(res, 400, { error: err ? 'Slika je prevelika (najviše 15 MB)' : 'Prazno' });
      var dir = ROOT + '/' + kind;
      try {
        try { fs.mkdirSync(dir); } catch (x) {}
        ['jpg', 'jpeg', 'png', 'webp'].forEach(function (e) { try { fs.unlinkSync(dir + '/' + name + '.' + e); } catch (x) {} });
        fs.writeFileSync(dir + '/' + name + '.' + ext, body);
      } catch (e) { return send(res, 500, { error: e.message }); }
      log('upload ' + kind + '/' + name + '.' + ext + ' (' + body.length + ' B)');
      launchDom({ dom: 'remote', cmd: { t: 'reload' } });
      send(res, 200, { ok: true });
    });
  }
  readBody(req, 64 * 1024, function (err, body) {
    if (err) return send(res, 400, { error: 'Prevelik zahtjev' });
    var j = {}; try { j = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'Neispravan JSON' }); }
    if (p === '/api/cmd') {
      if (!j || typeof j.t !== 'string') return send(res, 400, { error: 'Nema naredbe' });
      launchDom({ dom: 'remote', cmd: j });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/text') {
      var text = String(j.text || '').slice(0, 500);
      if (!text && !j.enter) return send(res, 400, { error: 'Prazno' });
      cp.execFile(NODE, [ROOT + '/dom-keys.js', 'text', text].concat(j.enter ? ['enter'] : []), { timeout: 30000 }, function (e) {
        send(res, e ? 500 : 200, e ? { error: 'TV nije primio tekst (je li Dom uparen? node dom-keys.js pair)' } : { ok: true });
      });
      return;
    }
    if (p === '/api/key') {
      var key = String(j.key || '').toUpperCase();
      if (KEYS.indexOf(key) < 0) return send(res, 400, { error: 'Nepoznata tipka' });
      cp.execFile(NODE, [ROOT + '/dom-keys.js', 'keys', '0', key], { timeout: 30000 }, function (e) { send(res, e ? 500 : 200, e ? { error: 'Tipka nije poslana' } : { ok: true }); });
      return;
    }
    if (p === '/api/delete-image') {
      var dir2 = j.kind === 'icon' ? 'dom-icons' : (j.kind === 'bg' ? 'dom-backgrounds' : ''), n2 = safeName(j.name);
      if (!dir2 || !n2) return send(res, 400, { error: 'Neispravno' });
      ['jpg', 'jpeg', 'png', 'webp'].forEach(function (e) { try { fs.unlinkSync(ROOT + '/' + dir2 + '/' + n2 + '.' + e); } catch (x) {} });
      launchDom({ dom: 'remote', cmd: { t: 'reload' } });
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'nema' });
  });
}
function web() {
  var want = has('dom-web-on');
  if (want && !server) {
    token = read(ROOT + '/dom-web-token').trim();
    if (!/^[a-z0-9]{8,}$/.test(token)) { token = crypto.randomBytes(5).toString('hex'); fs.writeFileSync(ROOT + '/dom-web-token', token, { mode: 384 }); }
    server = http.createServer(handle);
    server.on('error', function (e) { log('web: ' + e.message); server = null; webState(); });
    server.listen(PORT, function () { log('web: listening on ' + myIp() + ':' + PORT); webState(); });
  } else if (!want && server) {
    server.close(); server = null; log('web: stopped'); webState();
  } else if (server) webState();   // the address may change (DHCP, Wi-Fi to cable)
}

/* ---------------- start ---------------- */
log('start (pid ' + process.pid + ', node ' + process.version + ')');
watchInputs();
web();
setInterval(web, 4000);
setTimeout(checkEpisodes, 2 * 60000);
setInterval(checkEpisodes, 30 * 60000);
// switched on in Dom just now: do not make people wait half an hour for the first check
var notifyWas = has('dom-notify-on');
setInterval(function () { var n = has('dom-notify-on'); if (n && !notifyWas) setTimeout(checkEpisodes, 5000); notifyWas = n; }, 15000);
