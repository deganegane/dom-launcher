// Dom: a small QR code encoder, enough for a link (byte mode, error correction level M, versions 1-10).
// window.DOM_QR(text) -> rows of booleans (true = dark), or null if the text is too long.
(function () {
  // per version, level M: [error correction codewords per block, blocks in group 1, data codewords in each, blocks in group 2, data codewords in each]
  var EC = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // arithmetic in GF(256) with the QR polynomial 0x11d
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsGen(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = [];
      for (var j = 0; j <= g.length; j++) next[j] = (j < g.length ? g[j] : 0) ^ (j > 0 ? mul(g[j - 1], EXP[i]) : 0);
      g = next;
    }
    return g;   // highest degree first
  }
  function rsRem(data, n) {
    var g = rsGen(n), r = data.slice();
    for (var i = 0; i < n; i++) r.push(0);
    for (i = 0; i < data.length; i++) {
      var c = r[i];
      if (c) for (var j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c);
    }
    return r.slice(data.length);
  }
  function utf8(s) {
    var out = [], e = unescape(encodeURIComponent(s));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), v, ec;
    for (v = 1; v <= 10; v++) {
      ec = EC[v];
      var cap = ec[1] * ec[2] + ec[3] * ec[4], need = Math.ceil((4 + (v < 10 ? 8 : 16) + bytes.length * 8) / 8);
      if (need <= cap) break;
    }
    if (v > 10) return null;
    var dataLen = ec[1] * ec[2] + ec[3] * ec[4];
    // bit stream: mode 0100 (bytes), length, the bytes, terminator, padding
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, dataLen * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (var p = 0; data.length < dataLen; p++) data.push(p % 2 ? 0x11 : 0xec);
    // split into blocks, add error correction, interleave
    var blocks = [], at = 0;
    for (i = 0; i < ec[1] + ec[3]; i++) {
      var len = i < ec[1] ? ec[2] : ec[4], d = data.slice(at, at + len);
      at += len;
      blocks.push({ d: d, e: rsRem(d, ec[0]) });
    }
    var cw = [], maxD = Math.max(ec[2], ec[4]);
    for (i = 0; i < maxD; i++) blocks.forEach(function (bl) { if (i < bl.d.length) cw.push(bl.d[i]); });
    for (i = 0; i < ec[0]; i++) blocks.forEach(function (bl) { cw.push(bl.e[i]); });

    var n = 17 + 4 * v, m = [], fn = [];
    for (i = 0; i < n; i++) { m.push([]); fn.push([]); for (j = 0; j < n; j++) { m[i].push(false); fn[i].push(false); } }
    function set(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    for (i = 8; i < n - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    var al = ALIGN[v];
    for (i = 0; i < al.length; i++) for (j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) set(al[i] + ax, al[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
    }
    // reserve the format areas (written after masking), the dark module and the version blocks
    for (i = 0; i < 9; i++) { fn[8][i] = fn[i][8] = true; }
    for (i = 0; i < 8; i++) { fn[8][n - 1 - i] = fn[n - 1 - i][8] = true; }
    set(8, n - 8, true);
    if (v >= 7) {
      var vb = v; for (i = 0; i < 12; i++) vb = (vb << 1) ^ ((vb >>> 11) * 0x1f25);
      var vbits = (v << 12) | vb;
      for (i = 0; i < 18; i++) { var bit = ((vbits >>> i) & 1) === 1, a = n - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
    }
    // the codewords, in two-column zigzags from the bottom right
    var k = 0, total = cw.length * 8;
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < n; vert++) for (j = 0; j < 2; j++) {
        var x2 = right - j, up = ((right + 1) & 2) === 0, y2 = up ? n - 1 - vert : vert;
        if (fn[y2][x2]) continue;
        if (k < total) m[y2][x2] = ((cw[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
    // mask 0 ((x + y) % 2) is as readable as any; format bits for level M + mask 0
    for (y2 = 0; y2 < n; y2++) for (x2 = 0; x2 < n; x2++) if (!fn[y2][x2] && (x2 + y2) % 2 === 0) m[y2][x2] = !m[y2][x2];
    var fd = (0 << 3) | 0, rem = fd;   // level M = 00
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var fbits = ((fd << 10) | rem) ^ 0x5412;
    var fb = function (i) { return ((fbits >>> i) & 1) === 1; };
    for (i = 0; i <= 5; i++) m[i][8] = fb(i);
    m[7][8] = fb(6); m[8][8] = fb(7); m[8][7] = fb(8);
    for (i = 9; i < 15; i++) m[8][14 - i] = fb(i);
    for (i = 0; i < 8; i++) m[8][n - 1 - i] = fb(i);
    for (i = 8; i < 15; i++) m[n - 15 + i][8] = fb(i);
    m[n - 8][8] = true;
    return m;
  }
  window.DOM_QR = encode;
})();
