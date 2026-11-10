// Dom: press remote buttons through the TV's own second-screen API (SSAP),
// the same way phone remote apps and Home Assistant do.
//
//   node dom-keys.js pair            first-time pairing (accept the prompt on the TV)
//   node dom-keys.js keys 0 DOWN OK  wait 0 ms, then press the buttons
//   node dom-keys.js play <index>    open Stremio's Continue Watching item <index>
//                                    using the template in /home/root/dom-stremio-keys.txt
//
// Plain Node, no modules: minimal WebSocket client over tls/net.
'use strict';
var net = require('net');
var tls = require('tls');
var crypto = require('crypto');
var fs = require('fs');
var url = require('url');

var KEYFILE = '/home/root/dom-ssap-key';
var TEMPLATE_FILE = '/home/root/dom-stremio-keys.txt';
// <delay ms> then buttons; {RIGHT} expands to RIGHT pressed <index> times
var DEFAULT_TEMPLATE = '9000 {RIGHT} ENTER';
var STEP_MS = 350;

var PERMISSIONS = ['APP_TO_APP', 'CLOSE', 'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK',
  'CONTROL_INPUT_MEDIA_PLAYBACK', 'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_TEXT', 'CONTROL_INPUT_TV',
  'CONTROL_MOUSE_AND_KEYBOARD', 'CONTROL_POWER', 'CONTROL_TV_SCREEN', 'LAUNCH', 'LAUNCH_WEBAPP',
  'READ_APP_STATUS', 'READ_COUNTRY_INFO', 'READ_CURRENT_CHANNEL', 'READ_INPUT_DEVICE_LIST',
  'READ_INSTALLED_APPS', 'READ_LGE_SDX', 'READ_LGE_TV_INPUT_EVENTS', 'READ_NETWORK_STATE',
  'READ_NOTIFICATIONS', 'READ_POWER_STATE', 'READ_RUNNING_APPS', 'READ_SETTINGS', 'READ_TV_CHANNEL_LIST',
  'READ_TV_CURRENT_TIME', 'READ_UPDATE_INFO', 'SEARCH', 'TEST_OPEN', 'TEST_PROTECTED', 'TEST_SECURE',
  'UPDATE_FROM_REMOTE_APP', 'WRITE_NOTIFICATION_ALERT', 'WRITE_NOTIFICATION_TOAST', 'WRITE_SETTINGS'];

var started = Date.now();
function log() {
  var a = Array.prototype.slice.call(arguments);
  console.log(new Date().toISOString().slice(11, 19) + ' ' + a.join(' '));
}
function die(msg) { log('ERROR', msg); process.exit(1); }
setTimeout(function () { die('gave up after 90s'); }, 90000);

/* ---------- arguments ---------- */
var mode = process.argv[2] || 'pair';
var delay = 0, buttons = [];
if (mode === 'keys') {
  delay = parseInt(process.argv[3], 10) || 0;
  buttons = process.argv.slice(4);
} else if (mode === 'play') {
  var index = parseInt(process.argv[3], 10) || 0;
  var tpl = DEFAULT_TEMPLATE;
  try { tpl = fs.readFileSync(TEMPLATE_FILE, 'utf8').trim() || tpl; } catch (e) {}
  var parts = tpl.split(/\s+/);
  delay = parseInt(parts.shift(), 10) || 0;
  parts.forEach(function (p) {
    var m = /^\{(\w+)\}$/.exec(p);
    if (m) for (var i = 0; i < index; i++) buttons.push(m[1].toUpperCase());
    else if (p) buttons.push(p.toUpperCase());
  });
  log('template "' + tpl + '" index ' + index + ' ->', buttons.join(' ') || '(none)');
} else if (mode !== 'pair') {
  die('unknown mode ' + mode);
}

/* ---------- minimal websocket client ---------- */
function frame(data, op) {
  var p = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  var mask = crypto.randomBytes(4);
  var h;
  if (p.length < 126) h = Buffer.from([0x80 | (op || 1), 0x80 | p.length]);
  else { h = Buffer.alloc(4); h[0] = 0x80 | (op || 1); h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); }
  var m = Buffer.alloc(p.length);
  for (var i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4];
  return Buffer.concat([h, mask, m]);
}
function wsConnect(u, cb, origin) {
  var done = false;
  function once(err, ws) { if (!done) { done = true; cb(err, ws); } }
  var p = url.parse(u);
  var secure = p.protocol === 'wss:';
  var port = parseInt(p.port, 10) || (secure ? 443 : 80);
  var key = crypto.randomBytes(16).toString('base64');
  var sock = secure
    ? tls.connect({ host: p.hostname, port: port, rejectUnauthorized: false })
    : net.connect({ host: p.hostname, port: port });
  var buf = Buffer.alloc(0), open = false, frag = null;
  var ws = {
    onmessage: null,
    send: function (t) { log('[' + u + '] >> ' + String(t).slice(0, 120).replace(/\n/g, '\\n')); sock.write(frame(t)); },
    close: function () { try { sock.write(frame(Buffer.alloc(0), 8)); } catch (e) {} sock.end(); }
  };
  var timer = setTimeout(function () { sock.destroy(); once(new Error('timeout ' + u)); }, 6000);
  sock.on(secure ? 'secureConnect' : 'connect', function () {
    sock.write('GET ' + (p.path || '/') + ' HTTP/1.1\r\nHost: ' + p.host + '\r\nUpgrade: websocket\r\n' +
      'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n' +
      (origin ? 'Origin: ' + origin + '\r\n' : '') + '\r\n');
  });
  sock.on('data', function (d) {
    buf = Buffer.concat([buf, d]);
    if (!open) {
      var i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      var head = buf.slice(0, i).toString();
      buf = buf.slice(i + 4);
      clearTimeout(timer);
      if (!/^HTTP\/1\.1 101/.test(head)) { sock.destroy(); return once(new Error('handshake: ' + head.split('\r\n')[0])); }
      open = true;
      log('[' + u + '] connected');
      once(null, ws);
    }
    for (;;) {
      if (buf.length < 2) return;
      var len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
      if (buf.length < off + len) return;
      var fin = (buf[0] & 0x80) !== 0, op = buf[0] & 15, masked = (buf[1] & 0x80) !== 0;
      if (masked) { if (buf.length < off + 4 + len) return; var mk = buf.slice(off, off + 4); off += 4; }
      var payload = Buffer.from(buf.slice(off, off + len));
      if (masked) for (var j = 0; j < payload.length; j++) payload[j] ^= mk[j % 4];
      buf = buf.slice(off + len);
      if (op === 9) { sock.write(frame(payload, 10)); continue; } // ping -> pong
      if (op === 8) { ws.closeReason = payload.slice(2).toString(); log('[' + u + '] closed by TV: ' + ws.closeReason); continue; }
      if (op === 1 || op === 0) {
        frag = frag ? Buffer.concat([frag, payload]) : payload;
        if (fin) { var t = frag.toString(); frag = null; if (ws.onmessage) ws.onmessage(t); }
      }
    }
  });
  sock.on('error', function (e) { clearTimeout(timer); log('[' + u + '] error ' + e.message); once(e); });
  sock.on('close', function () { if (open) { log('[' + u + '] socket closed'); if (ws.onclose) ws.onclose(ws.closeReason || ''); } });
}

/* ---------- SSAP ---------- */
// Which endpoint/origin the TV accepts differs by firmware: connections from
// 127.0.0.1 are origin-checked on newer webOS, the LAN address is treated like
// a phone app. Try them in order; remember the one that worked.
var ENDPOINT_FILE = '/home/root/dom-ssap-endpoint';
function candidates() {
  var list = [], ips = [];
  var ifs = require('os').networkInterfaces();
  Object.keys(ifs).forEach(function (n) {
    (ifs[n] || []).forEach(function (a) { if ((a.family === 'IPv4' || a.family === 4) && !a.internal) ips.push(a.address); });
  });
  ips.forEach(function (ip) {
    list.push({ url: 'wss://' + ip + ':3001/' }, { url: 'ws://' + ip + ':3000/' });
  });
  ['', 'http://127.0.0.1', 'http://localhost', 'file://', 'null'].forEach(function (o) {
    list.push({ url: 'wss://127.0.0.1:3001/', origin: o }, { url: 'ws://127.0.0.1:3000/', origin: o });
  });
  try {
    var saved = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
    if (saved && saved.url) list.unshift(saved);
  } catch (e) {}
  return list;
}

var clientKey = '';
try { clientKey = fs.readFileSync(KEYFILE, 'utf8').trim(); } catch (e) {}

var CANDS = candidates();
function attempt(i) {
  if (i >= CANDS.length) die('TV API refused every endpoint (see log above)');
  var c = CANDS[i];
  log('trying ' + c.url + (c.origin ? ' origin=' + c.origin : ''));
  wsConnect(c.url, function (err, ws) {
  if (err) { log('  failed: ' + err.message); return attempt(i + 1); }
  ws.onclose = function (reason) { if (!replied) { log('  closed before reply' + (reason ? ' (' + reason + ')' : '')); attempt(i + 1); } };
  log('client-key: ' + (clientKey ? 'yes' : 'none (pairing needed)'));
  var replied = false;
  setTimeout(function () { if (!replied) { log('  no reply after 12s'); ws.onclose = null; ws.close(); attempt(i + 1); } }, 12000);
  ws.onmessage = function (txt) {
    if (!replied) { replied = true; try { fs.writeFileSync(ENDPOINT_FILE, JSON.stringify(c)); } catch (e) {} }
    log('<< ' + txt.slice(0, 300));
    var msg;
    try { msg = JSON.parse(txt); } catch (e) { return; }
    var pl = msg.payload || {};
    if (msg.type === 'response' && msg.id === 'register_0' && pl.pairingType === 'PROMPT') {
      log('waiting for approval on the TV (press OK on the prompt)');
    } else if (msg.type === 'registered') {
      if (pl['client-key'] && pl['client-key'] !== clientKey) {
        fs.writeFileSync(KEYFILE, pl['client-key']);
        log('paired, key saved');
      }
      if (mode === 'pair') { log('pairing OK'); ws.close(); process.exit(0); }
      ws.send(JSON.stringify({ type: 'request', id: 'ptr', uri: 'ssap://com.webos.service.networkinput/getPointerInputSocket' }));
    } else if (msg.id === 'ptr') {
      if (!pl.socketPath) die('no pointer socket: ' + txt);
      openPointer(pl.socketPath, ws, c.origin);
    } else if (msg.type === 'error') {
      die(msg.error || txt);
    }
  };
  ws.send(JSON.stringify({
    type: 'register', id: 'register_0',
    payload: {
      forcePairing: false, pairingType: 'PROMPT', 'client-key': clientKey || undefined,
      manifest: { appVersion: '1.1', manifestVersion: 1, permissions: PERMISSIONS }
    }
  }));
  }, c.origin);
}
attempt(0);

function openPointer(path, main, origin) {
  wsConnect(path, function (err, ptr) {
    if (err) die('pointer socket: ' + err.message);
    var wait = Math.max(0, delay - (Date.now() - started));
    log('connected, pressing in ' + wait + ' ms:', buttons.join(' ') || '(none)');
    setTimeout(function () {
      var i = 0;
      (function next() {
        if (i >= buttons.length) {
          log('done');
          setTimeout(function () { ptr.close(); main.close(); process.exit(0); }, 300);
          return;
        }
        ptr.send('type:button\nname:' + buttons[i++] + '\n\n');
        setTimeout(next, STEP_MS);
      })();
    }, wait);
  }, origin);
}
