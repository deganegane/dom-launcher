// Dom background helper, runs as root next to the home guard:
//  - consoles: watches the HDMI inputs and tells Dom when a PlayStation, Xbox or Switch comes on
//  - new episodes: asks Stremio every half hour and shows a TV notice, whatever is on screen
//    (only while /home/root/dom-notify-on exists)
//  - forgotten apps: closes an app that has not been on screen for the minutes in /home/root/dom-autoclose
// Plain Node, no modules.  Log: /tmp/dom-agent.log
'use strict';
var fs = require('fs');
var cp = require('child_process');

var APPID = 'com.deganegane.dom';
var ROOT = '/home/root';
var LOG = '/tmp/dom-agent.log';

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
// "connected" only means a cable is in (it stays true while the console sleeps). A console that is on
// either sends a picture (hdmiSignalExist) or says so over HDMI-CEC (subList SIMPLINK, cecPower "On").
var CONSOLE_RE = /ps5|ps4|playstation|xbox|nintendo|switch/i;
var inputs = null;
function consoleMode() { return read(ROOT + '/dom-console-mode').trim() || 'ask'; }
function inputLog(msg) {
  try {
    var f = '/tmp/dom-inputs.log';
    if (fs.existsSync(f) && fs.statSync(f).size > 60000) fs.writeFileSync(f, '');
    fs.appendFileSync(f, new Date().toTimeString().slice(0, 8) + ' ' + msg + '\n');
  } catch (e) {}
}
function inputDevices(j) {
  var devs = (j && (j.devices || j.inputs)) || [];
  if (!devs.length) return;
  var now = {};
  devs.forEach(function (d) {
    var id = d.id || d.inputId || d.deviceId;
    if (!id) return;
    var sub = d.subList || [], cec = '', names = [d.label || '', id];
    sub.forEach(function (x) { if (x.cecPower) cec = String(x.cecPower); names.push(x.osdName || '', x.brandName || '', x.labelName || ''); });
    now[id] = { on: d.hdmiSignalExist === true || /^on$/i.test(cec), signal: d.hdmiSignalExist, cec: cec,
                label: d.label || d.deviceName || d.name || '', names: names.join(' '), app: d.appId || '', port: d.port };
  });
  Object.keys(now).forEach(function (id) {
    var n = now[id], o = inputs && inputs[id];
    if (!o || o.signal !== n.signal || o.cec !== n.cec) inputLog(id + ' "' + n.label + '" signal=' + n.signal + ' cec=' + (n.cec || '-'));
    if (!inputs || !n.on || (o && o.on)) return;   // the first reading is only the starting point
    var app = n.app || (n.port ? 'com.webos.app.hdmi' + n.port : '');
    if (!CONSOLE_RE.test(n.names) || !app) return;
    var mode = consoleMode(), fg = foreground();
    log('console on: ' + n.label + ' (' + id + '), mode ' + mode + ', on screen ' + fg);
    if (mode === 'off' || fg !== APPID) return;   // never interrupt something that is playing
    launchDom({ dom: 'console', appId: app, label: n.label });
  });
  inputs = now;
}
function watchInputs() {
  subscribe('luna://com.webos.service.eim/getAllInputStatus', { subscribe: true }, function (j) { inputDevices(j); });
  // not every firmware sends an update when a console wakes up: while Dom is on screen, also ask every 5 s
  setInterval(function () {
    if (foreground() !== APPID || consoleMode() === 'off') return;
    lunaSend('luna://com.webos.service.eim/getAllInputStatus', {}, function (err, out) {
      var j = null; try { j = JSON.parse(out); } catch (e) {}
      if (j) inputDevices(j);
    });
  }, 5000);
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

/* ---------------- forgotten apps ---------------- */
// apps that keep running in the background hold memory; the ones nobody went back to are closed
var KEEP_RE = /^com\.deganegane\.dom$|^com\.webos\.app\.(home|starfish|systemui|screensaver)|^com\.webos\.surfacemanager|stremio/i;
var lastSeen = {};
function autoClose() {
  var fg = foreground(), now = Date.now();
  if (fg) lastSeen[fg] = now;
  var mins = parseInt(read(ROOT + '/dom-autoclose'), 10) || 0;
  if (!mins) return;
  lunaSend('luna://com.webos.applicationManager/running', {}, function (err, out) {
    var j = null; try { j = JSON.parse(out); } catch (e) {}
    ((j && j.running) || []).forEach(function (r) {
      var id = r.id;
      if (!id || id === fg || KEEP_RE.test(id)) return;
      if (!lastSeen[id]) { lastSeen[id] = now; return; }   // first time we see it: the clock starts now
      if (now - lastSeen[id] < mins * 60000) return;
      log('closing ' + id + ' (not on screen for ' + Math.round((now - lastSeen[id]) / 60000) + ' min)');
      delete lastSeen[id];
      lunaSend('luna://com.webos.service.applicationManager/closeByAppId', { id: id });
    });
  });
}

/* ---------------- start ---------------- */
log('start (pid ' + process.pid + ', node ' + process.version + ')');
watchInputs();
setInterval(function () { var fg = foreground(); if (fg) lastSeen[fg] = Date.now(); }, 10000);
setInterval(autoClose, 5 * 60000);
setTimeout(checkEpisodes, 2 * 60000);
setInterval(checkEpisodes, 30 * 60000);
// switched on in Dom just now: do not make people wait half an hour for the first check
var notifyWas = has('dom-notify-on');
setInterval(function () { var n = has('dom-notify-on'); if (n && !notifyWas) setTimeout(checkEpisodes, 5000); notifyWas = n; }, 15000);
