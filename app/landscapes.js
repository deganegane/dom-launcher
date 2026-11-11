// Dom: illustrated landscapes drawn on the TV itself (no network). window.DOM_LANDSCAPE(seed) -> { url, title }
// Four kinds of scene, each with a few palettes: a lake under the moon, a valley at sunset,
// a coast with a lighthouse, and peaks above the clouds.
(function () {
  var W = 1920, H = 1080;
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mix(a, b, t) {
    var x = hex(a), y = hex(b);
    return '#' + [0, 1, 2].map(function (i) { return ('0' + Math.round(x[i] + (y[i] - x[i]) * t).toString(16)).slice(-2); }).join('');
  }
  function f(n) { return (Math.round(n * 10) / 10).toString(); }
  // natural-looking ridge line: midpoint displacement, values 0..1 at n+1 points
  function ridge(r, rough, n) {
    var a = [], i, step = n, scale = 1;
    a[0] = r() * 2 - 1; a[n] = r() * 2 - 1;
    while (step > 1) {
      var half = step / 2;
      for (i = half; i < n; i += step) a[i] = (a[i - half] + a[i + half]) / 2 + (r() * 2 - 1) * scale;
      scale *= rough; step = half;
    }
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a);
    return a.map(function (v) { return (v - mn) / (mx - mn || 1); });
  }
  // shape(x 0..1) scales the ridge: valleys, slopes to one side and so on
  function land(h, base, amp, shape, bottom) {
    var n = h.length - 1, d = 'M0 ' + (bottom || H), ys = [];
    for (var i = 0; i <= n; i++) {
      var x = i / n, y = base - h[i] * amp * (shape ? shape(x) : 1);
      ys.push(y);
      d += 'L' + f(x * W) + ' ' + f(y);
    }
    return { d: d + 'L' + W + ' ' + (bottom || H) + 'Z', ys: ys, n: n };
  }
  function at(l, x) { return l.ys[Math.max(0, Math.min(l.n, Math.round(x / W * l.n)))]; }
  function valley(depth, centre) { return function (x) { return (1 - depth) + depth * Math.min(1, Math.pow(Math.abs(x - (centre || 0.5)) * 2, 0.9)); }; }
  function grad(id, stops, vertical) {
    var s = '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + (vertical === false ? 1 : 0) + '" y2="' + (vertical === false ? 0 : 1) + '">';
    stops.forEach(function (c, i) { s += '<stop offset="' + f(i / (stops.length - 1)) + '" stop-color="' + c + '"/>'; });
    return s + '</linearGradient>';
  }
  function glowDef(id, c, o) { return '<radialGradient id="' + id + '"><stop offset="0" stop-color="' + c + '" stop-opacity="' + o + '"/><stop offset=".45" stop-color="' + c + '" stop-opacity="' + f(o * 0.35) + '"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>'; }
  function stars(r, n, maxY, c) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var x = r() * W, y = r() * maxY, big = r() < 0.07;
      if (big) {   // a four-pointed sparkle
        var k = 7 + r() * 9;
        s += '<path d="M' + f(x) + ' ' + f(y - k) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x + k) + ' ' + f(y) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x) + ' ' + f(y + k) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x - k) + ' ' + f(y) + 'Q' + f(x) + ' ' + f(y) + ' ' + f(x) + ' ' + f(y - k) + 'Z" fill="' + c + '" opacity=".9"/>';
      } else s += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(0.7 + r() * r() * 2.6) + '" fill="' + c + '" opacity="' + f(0.35 + r() * 0.6) + '"/>';
    }
    return s;
  }
  function birds(r, cx, cy, c) {
    var s = '', n = 3 + Math.floor(r() * 4);
    for (var i = 0; i < n; i++) {
      var x = cx + (r() - 0.5) * 260, y = cy + (r() - 0.5) * 150, k = 9 + r() * 12;
      s += '<path d="M' + f(x - k * 2) + ' ' + f(y - k * 0.3) + 'q' + f(k) + ' ' + f(-k * 0.6) + ' ' + f(k * 2) + ' ' + f(k * 0.5) + 'q' + f(k) + ' ' + f(-k * 1.1) + ' ' + f(k * 2) + ' ' + f(-k * 0.5) + '" fill="none" stroke="' + c + '" stroke-width="' + f(k * 0.28) + '" stroke-linecap="round"/>';
    }
    return s;
  }
  // flat poster cloud: scalloped top, straight bottom, a thin bar underneath
  function flatCloud(r, x, y, w, c, o) {
    var d = 'M' + f(x) + ' ' + f(y), left = w, cx = x;
    while (left > 20) {
      var rr = Math.min(left / 2, 26 + r() * 62);
      d += 'a' + f(rr) + ' ' + f(rr) + ' 0 0 1 ' + f(rr * 2) + ' 0';
      cx += rr * 2; left -= rr * 2;
    }
    return '<g fill="' + c + '" opacity="' + o + '"><path d="' + d + 'Z"/><rect x="' + f(x - w * 0.22) + '" y="' + f(y - 2) + '" width="' + f((cx - x) + w * 0.44) + '" height="14" rx="7"/></g>';
  }
  function puffCloud(r, x, y, w, c, o) {
    var s = '<g fill="' + c + '" opacity="' + o + '">', n = 6 + Math.floor(r() * 5);
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), rr = w * (0.12 + 0.12 * Math.sin(t * Math.PI) + r() * 0.05);
      s += '<circle cx="' + f(x + (t - 0.5) * w) + '" cy="' + f(y - rr * 0.6 - Math.sin(t * Math.PI) * w * 0.08) + '" r="' + f(rr) + '"/>';
    }
    return s + '<rect x="' + f(x - w * 0.6) + '" y="' + f(y - w * 0.1) + '" width="' + f(w * 1.2) + '" height="' + f(w * 0.16) + '" rx="' + f(w * 0.08) + '"/></g>';
  }
  function pine(x, y, h, c) {   // tiers of triangles on a short trunk
    var s = '', tiers = 4 + Math.round(h / 90), w = h * 0.36;
    for (var i = 0; i < tiers; i++) {
      var t0 = i / tiers, top = y - h + t0 * h * 0.82, tw = w * (0.28 + 0.72 * (i + 1) / tiers), th = h * (0.34 - 0.02 * i);
      s += 'M' + f(x) + ' ' + f(top) + 'L' + f(x + tw / 2) + ' ' + f(top + th) + 'L' + f(x - tw / 2) + ' ' + f(top + th) + 'Z';
    }
    return '<path d="' + s + 'M' + f(x - h * 0.02) + ' ' + f(y - h * 0.2) + 'h' + f(h * 0.04) + 'V' + f(y + 8) + 'h' + f(-h * 0.04) + 'Z" fill="' + c + '"/>';
  }
  function treeLine(r, l, c, minH, maxH, gap) {   // small pines standing along a ridge
    var d = '';
    for (var x = r() * gap; x < W; x += gap * (0.5 + r())) {
      var y = at(l, x) + 6, h = minH + r() * (maxH - minH), w = h * 0.3;
      d += 'M' + f(x - w) + ' ' + f(y) + 'L' + f(x) + ' ' + f(y - h) + 'L' + f(x + w) + ' ' + f(y) + 'Z';
    }
    return '<path d="' + d + '" fill="' + c + '"/>';
  }
  // two-tone faceted peak: dark body, lit side with a jagged edge down the middle
  function peak(r, px, py, hw, base, dark, light, litRight) {
    var s = litRight ? 1 : -1, sh = (base - py);
    var body = 'M' + f(px - hw * (1 + r() * 0.25)) + ' ' + f(base) + 'L' + f(px - hw * 0.45) + ' ' + f(py + sh * (0.42 + r() * 0.1)) + 'L' + f(px) + ' ' + f(py) +
               'L' + f(px + hw * 0.5) + ' ' + f(py + sh * (0.46 + r() * 0.1)) + 'L' + f(px + hw * (1 + r() * 0.25)) + ' ' + f(base) + 'Z';
    var lit = 'M' + f(px) + ' ' + f(py) + 'L' + f(px + s * hw * 0.5) + ' ' + f(py + sh * 0.5) + 'L' + f(px + s * hw * 1.05) + ' ' + f(base) + 'L' + f(px + s * hw * 0.12) + ' ' + f(base), steps = 5;
    for (var i = steps - 1; i >= 1; i--) {
      var t = i / steps;
      lit += 'L' + f(px + s * hw * (i % 2 ? 0.13 : 0.01) * t * 1.4) + ' ' + f(py + sh * t);
    }
    return '<path d="' + body + '" fill="' + dark + '"/><path d="' + lit + 'Z" fill="' + light + '"/>';
  }
  function svg(defs, body) {
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs>' + defs + '</defs>' + body + '</svg>');
  }
  function pick(r, a) { return a[Math.floor(r() * a.length)]; }

  /* ---------------- 1: a lake under the moon ---------------- */
  var LAKE = [
    { name: 'Jezero · noć', sky: ['#020b33', '#0a2f9c', '#3f8fea'], orb: '#f2f7ff', glow: '#8fd0ff', far: ['#1f55c9', '#123c9e', '#0b2b78', '#081f57'], near: '#040f2e', water: ['#8fb5ff', '#3f79e6', '#0a3fae'], star: '#ffffff', stars: 90 },
    { name: 'Jezero · sumrak', sky: ['#1b1040', '#6a2a7e', '#f0877a'], orb: '#ffe6c2', glow: '#ffb38a', far: ['#9a4f95', '#733a86', '#4f2a70', '#35205a'], near: '#160b2c', water: ['#f6b6a2', '#b0689f', '#3b2468'], star: '#fff3e6', stars: 50 },
    { name: 'Jezero · svitanje', sky: ['#103a52', '#2f8f9b', '#f5d6a8'], orb: '#fff7de', glow: '#ffe2a6', far: ['#4fa3a5', '#34858d', '#236a76', '#184f5d'], near: '#082a33', water: ['#f7e0b4', '#6fb7b3', '#16586a'], star: '#ffffff', stars: 14 },
    { name: 'Jezero · zalazak', sky: ['#2a0f3d', '#b83b5e', '#ffb35c'], orb: '#fff1c9', glow: '#ff9d5c', far: ['#c9566a', '#9c3f63', '#6f2d58', '#4a2049'], near: '#1c0b22', water: ['#ffc98a', '#d1607a', '#4b1f52'], star: '#ffe9d0', stars: 30 }
  ];
  function lake(r) {
    var p = pick(r, LAKE), WL = 690 + r() * 40, i, defs = grad('sky', p.sky) + glowDef('glow', p.glow, 0.85) + grad('wat', p.water), b = '';
    b += '<rect width="' + W + '" height="' + f(WL + 4) + '" fill="url(#sky)"/>' + stars(r, p.stars, WL - 180, p.star);
    var ox = 520 + r() * 880, oy = 190 + r() * 150, or = 60 + r() * 34;
    b += '<circle cx="' + f(ox) + '" cy="' + f(oy) + '" r="' + f(or * 5) + '" fill="url(#glow)"/><circle cx="' + f(ox) + '" cy="' + f(oy) + '" r="' + f(or) + '" fill="' + p.orb + '"/>';
    var farG = '', vc = 0.35 + r() * 0.3;
    for (i = 0; i < 4; i++) {
      var side = (i % 2 ? 1 : -1) * (r() < 0.5 ? 1 : -1);
      var l = land(ridge(r, 0.52, 128), WL - 150 + i * 46, 380 - i * 56, (function (side, c, i) {
        return function (x) { var v = valley(0.75, c)(x); return v * (0.55 + 0.45 * (side > 0 ? x : 1 - x)) + 0.12 * i; };
      })(side, vc + (r() - 0.5) * 0.2, i), WL + 2);
      defs += grad('f' + i, [p.far[i], mix(p.far[i], p.far[Math.min(3, i + 1)], 0.8)]);
      farG += '<path d="' + l.d + '" fill="url(#f' + i + ')"/>';
      if (i === 1) farG += birds(r, ox + (r() - 0.5) * 500, WL - 330 + r() * 90, mix(p.near, p.far[3], 0.3));
    }
    // dark wooded shores on both sides, leaving the middle open
    for (i = 0; i < 2; i++) {
      var l2 = land(ridge(r, 0.62, 256), WL + 4, 150 + i * 60, (function (left) { return function (x) { var t = left ? 1 - x / 0.62 : (x - 0.38) / 0.62; return Math.max(0, Math.min(1, t)) * (0.5 + 0.5 * Math.max(0, t)); }; })(i === 0), WL + 4);
      farG += '<path d="' + l2.d + '" fill="' + mix(p.far[3], p.near, 0.55 + i * 0.3) + '"/>';
    }
    b += '<g id="far">' + farG + '</g>';
    // water: its own gradient, the mirrored land on top, then ripples
    b += '<rect y="' + f(WL) + '" width="' + W + '" height="' + f(H - WL) + '" fill="url(#wat)"/>';
    defs += '<clipPath id="wc"><rect y="' + f(WL) + '" width="' + W + '" height="' + f(H - WL) + '"/></clipPath>';
    b += '<g clip-path="url(#wc)"><use href="#far" transform="translate(0 ' + f(WL * 1.78) + ') scale(1 -0.78)" opacity=".42"/>' +
         '<ellipse cx="' + f(ox) + '" cy="' + f(WL + 150) + '" rx="' + f(or * 1.6) + '" ry="260" fill="url(#glow)" opacity=".8"/>';
    for (i = 0; i < 16; i++) {
      var ry = WL + 14 + r() * (H - WL - 40), rw = 60 + r() * 380;
      b += '<rect x="' + f(r() * W - rw / 2) + '" y="' + f(ry) + '" width="' + f(rw) + '" height="' + f(1.5 + (ry - WL) / 110) + '" rx="2" fill="#ffffff" opacity="' + f(0.05 + r() * 0.12) + '"/>';
    }
    b += '</g>';
    // foreground shore sweeping in from one side
    var fromLeft = r() < 0.5, d = 'M' + (fromLeft ? 0 : W) + ' ' + H + 'L' + (fromLeft ? 0 : W) + ' ' + f(WL + 70 + r() * 40), ph = r() * 6, reach = W * (0.55 + r() * 0.35);
    for (i = 1; i <= 40; i++) {
      var t = i / 40, x = t * reach + Math.sin(t * 9 + ph) * 110 * (1 - t * 0.6) * (0.4 + t), y = WL + 80 + Math.pow(t, 0.85) * (H - WL - 80);
      d += 'L' + f(fromLeft ? x : W - x) + ' ' + f(y);
    }
    b += '<path d="' + d + 'L' + (fromLeft ? 0 : W) + ' ' + H + 'Z" fill="' + p.near + '"/>';
    return { d: defs, b: b, name: p.name };
  }

  /* ---------------- 2: a valley at sunset, poster style ---------------- */
  var VALLEY = [
    { name: 'Dolina · zalazak', sky: ['#47695f', '#b9785f', '#ff8a5c'], cloud: '#ffc477', sun: '#ffdc8f', peakD: '#3b2230', peakL: '#e77d5c', backD: '#7a4250', backL: '#f09a6c', glow: ['#ffb02e', '#f58a2a'], forest: ['#2f8477', '#1f5d58', '#143f40'], river: ['#ffd58a', '#ff8f7a'], fg: '#231722', bird: '#3b2230' },
    { name: 'Dolina · sumrak', sky: ['#1c1d4a', '#5a3b85', '#f07fa0'], cloud: '#f7a8c0', sun: '#ffd9c2', peakD: '#221a4a', peakL: '#8f5fb5', backD: '#4a3580', backL: '#c58ad0', glow: ['#f58bb0', '#b85fa8'], forest: ['#3b4f95', '#2a3873', '#1b2452'], river: ['#ffc7d6', '#9a78d8'], fg: '#110d2a', bird: '#221a4a' },
    { name: 'Dolina · jutro', sky: ['#5fa8b8', '#a8d3c4', '#ffe1b0'], cloud: '#fff4d6', sun: '#fff2c4', peakD: '#3f6b7a', peakL: '#e9c9a0', backD: '#6f9aa3', backL: '#f6dcb4', glow: ['#ffd98f', '#f2b872'], forest: ['#4f9a7c', '#33735f', '#1f4f47'], river: ['#fff0c9', '#9fd6cf'], fg: '#12322f', bird: '#3f6b7a' }
  ];
  function valleyScene(r) {
    var p = pick(r, VALLEY), i, defs = grad('sky', p.sky) + grad('glw', p.glow) + grad('riv', p.river), b = '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    for (i = 0; i < 6; i++) b += flatCloud(r, r() * W - 120, 110 + r() * 430, 150 + r() * 330, p.cloud, 1);
    var sx = 760 + r() * 400, sy = 600 + r() * 50, lit = sx < W / 2;
    b += '<circle cx="' + f(sx) + '" cy="' + f(sy) + '" r="' + f(150 + r() * 50) + '" fill="' + p.sun + '"/>';
    // back range, then the big front peaks to the sides of the sun
    for (i = 0; i < 5; i++) { var bx = 120 + i * 430 + (r() - 0.5) * 200; if (Math.abs(bx - sx) > 220) b += peak(r, bx, 330 + r() * 130, 210 + r() * 120, 760, p.backD, p.backL, bx < sx); }
    b += peak(r, sx - 520 - r() * 240, 250 + r() * 90, 360 + r() * 120, 800, p.peakD, p.peakL, true);
    b += peak(r, sx + 520 + r() * 240, 300 + r() * 110, 320 + r() * 120, 800, p.peakD, p.peakL, false);
    // glowing slopes, then three bands of forest closing in on the valley
    var g = land(ridge(r, 0.5, 64), 720, 190, valley(0.9, sx / W));
    b += '<path d="' + g.d + '" fill="url(#glw)"/>';
    for (i = 0; i < 3; i++) {
      var l = land(ridge(r, 0.55, 128), 800 + i * 50, 200 + i * 30, valley(0.92, sx / W + (r() - 0.5) * 0.1));
      b += '<path d="' + l.d + '" fill="' + p.forest[i] + '"/>' + treeLine(r, l, p.forest[i], 34 + i * 18, 70 + i * 34, 30 - i * 4);
    }
    // the river: narrow far away, wide at our feet
    var ph = r() * 6, L = '', R = [], n = 36;
    for (i = 0; i <= n; i++) {
      var t = i / n, y = 870 + t * (H - 870), cx = sx + Math.sin(t * 2.4 + ph) * 260 * t, hw = 16 + t * t * 560;
      L += (i ? 'L' : 'M') + f(cx - hw) + ' ' + f(y); R.push('L' + f(cx + hw) + ' ' + f(y));
    }
    b += '<path d="' + L + R.reverse().join('') + 'Z" fill="url(#riv)"/>';
    for (i = 0; i < 7; i++) { var ry = 900 + r() * 160, rw = 60 + (ry - 870) * 1.6; b += '<rect x="' + f(sx - rw / 2 + (r() - 0.5) * rw * 1.4) + '" y="' + f(ry) + '" width="' + f(rw) + '" height="4" rx="2" fill="#ffffff" opacity=".22"/>'; }
    // dark banks with tall pines framing the picture
    [0, 1].forEach(function (side) {
      var l = land(ridge(r, 0.5, 64), H + 10, 250, function (x) { var t = side ? (x - 0.45) / 0.55 : (0.55 - x) / 0.55; return Math.max(0, t) * 1.1; });
      b += '<path d="' + l.d + '" fill="' + p.fg + '"/>';
      for (var k = 0; k < 4; k++) { var x = side ? W - 40 - k * 105 - r() * 50 : 40 + k * 105 + r() * 50; b += pine(x, at(l, x) + 20, 520 - k * 95 + r() * 60, p.fg); }
    });
    b += birds(r, sx + (r() - 0.5) * 600, 250 + r() * 120, p.bird);
    return { d: defs, b: b, name: p.name };
  }

  /* ---------------- 3: a coast with a lighthouse ---------------- */
  var COAST = [
    { name: 'Obala · sumrak', sky: ['#0d2a52', '#5b3a72', '#f0617a', '#ff8a6b'], band: ['#3f2f66', '#a14a7a', '#ff7f8f'], sun: '#ffe9b8', sea: ['#ff7fa6', '#8a4f8f', '#12224f'], far: ['#b0507f', '#7a3f78', '#4b2f66'], rock: ['#0f3b66', '#0a2a4f', '#061c3a'], lamp: '#7ff5ee', streak: '#ffb3c7' },
    { name: 'Obala · zlatni sat', sky: ['#274060', '#b0607a', '#ffa65c', '#ffd27a'], band: ['#5f4a78', '#d9777a', '#ffc27a'], sun: '#fff3c9', sea: ['#ffc97f', '#c9706f', '#22304f'], far: ['#c98a6a', '#9a5f66', '#63405c'], rock: ['#2f2a45', '#211d36', '#141226'], lamp: '#fff2a8', streak: '#ffe2a8' },
    { name: 'Obala · plavi sat', sky: ['#081a3a', '#143f78', '#4f8fd0', '#bfe0f0'], band: ['#103060', '#2f67a8', '#8fc1e8'], sun: '#f4fbff', sea: ['#bfe0f5', '#3f7fc0', '#0a2552'], far: ['#4f86c0', '#2f5f9c', '#1c3f78'], rock: ['#0b2242', '#07172f', '#040e20'], lamp: '#ffe98a', streak: '#e6f4ff' }
  ];
  function coast(r) {
    var p = pick(r, COAST), HZ = 640 + r() * 40, i, defs = grad('sky', p.sky) + grad('sea', p.sea) + glowDef('lg', p.lamp, 0.9), b = '<rect width="' + W + '" height="' + f(HZ + 2) + '" fill="url(#sky)"/>';
    // long soft bands of cloud
    for (i = 0; i < 7; i++) {
      var y = 90 + i * 70 + r() * 40, x0 = -200 + r() * 900, w = 700 + r() * 1100, h = 40 + r() * 70;
      b += '<path d="M' + f(x0) + ' ' + f(y) + 'Q' + f(x0 + w * 0.3) + ' ' + f(y - h) + ' ' + f(x0 + w * 0.6) + ' ' + f(y - h * 0.4) + 'T' + f(x0 + w) + ' ' + f(y) + 'Z" fill="' + p.band[Math.min(2, Math.floor(i / 2.4))] + '" opacity="' + f(0.35 + r() * 0.3) + '"/>';
    }
    var left = r() < 0.5, sx = left ? 1050 + r() * 350 : 520 + r() * 350;
    b += '<circle cx="' + f(sx) + '" cy="' + f(HZ + 10) + '" r="' + f(95 + r() * 40) + '" fill="' + p.sun + '"/>';
    // far headlands on the side away from the cliff
    for (i = 0; i < 3; i++) {
      var l = land(ridge(r, 0.5, 64), HZ + 6 + i * 26, 250 - i * 55, (function (i) { return function (x) { var t = left ? (x - (0.35 + i * 0.12)) / 0.65 : ((0.65 - i * 0.12) - x) / 0.65; return Math.max(0, t); }; })(i), HZ + 8 + i * 26);
      b += '<path d="' + l.d + '" fill="' + p.far[i] + '"/>';
    }
    // the sea, with streaks of light towards the sun
    b += '<rect y="' + f(HZ) + '" width="' + W + '" height="' + f(H - HZ) + '" fill="url(#sea)"/>';
    for (i = 0; i < 26; i++) {
      var ry = HZ + 12 + Math.pow(r(), 1.4) * (H - HZ - 30), spread = 120 + (ry - HZ) * 2.6, rw = 50 + r() * 420 * ((ry - HZ) / 300 + 0.3);
      b += '<rect x="' + f(sx + (r() - 0.5) * spread * 2 - rw / 2) + '" y="' + f(ry) + '" width="' + f(rw) + '" height="' + f(2 + (ry - HZ) / 90) + '" rx="3" fill="' + p.streak + '" opacity="' + f(0.25 + r() * 0.5) + '"/>';
    }
    // the cliff: three overlapping faceted layers rising to one side
    var cliff;
    for (i = 0; i < 3; i++) {
      var c = land(ridge(r, 0.62, 64), H + 10, H + 10 - (HZ - 190 + i * 135), (function (i) { return function (x) { var t = left ? (0.62 + i * 0.1 - x) / 0.62 : (x - (0.38 - i * 0.1)) / 0.62; return Math.pow(Math.max(0, Math.min(1.1, t)), 0.8); }; })(i), H);
      if (i === 0) cliff = c;
      b += '<path d="' + c.d + '" fill="' + p.rock[i] + '"/>';
    }
    // the lighthouse stands on the top of the back layer
    var lx = left ? 250 + r() * 220 : W - 250 - r() * 220, ly = at(cliff, lx) + 14, th = 250 + r() * 60, bw = 30, tw = 21, col = mix(p.rock[0], '#ffffff', 0.08);
    b += '<circle cx="' + f(lx) + '" cy="' + f(ly - th - 26) + '" r="170" fill="url(#lg)"/>' +
         '<path d="M' + f(lx - bw) + ' ' + f(ly) + 'L' + f(lx - tw) + ' ' + f(ly - th) + 'h' + f(tw * 2) + 'L' + f(lx + bw) + ' ' + f(ly) + 'Z" fill="' + col + '"/>' +
         '<rect x="' + f(lx - tw - 9) + '" y="' + f(ly - th - 8) + '" width="' + f(tw * 2 + 18) + '" height="9" fill="' + p.rock[1] + '"/>' +
         '<rect x="' + f(lx - tw + 3) + '" y="' + f(ly - th - 46) + '" width="' + f(tw * 2 - 6) + '" height="38" fill="' + p.lamp + '"/>' +
         '<path d="M' + f(lx - tw - 2) + ' ' + f(ly - th - 46) + 'h' + f(tw * 2 + 4) + 'l' + f(-tw * 0.6) + ' -22h' + f(-tw * 0.8 - 4) + 'Z" fill="' + p.rock[1] + '"/>' +
         '<rect x="' + f(lx - 1.5) + '" y="' + f(ly - th - 46) + '" width="3" height="38" fill="' + p.rock[1] + '"/>';
    for (i = 0; i < 2; i++) b += '<rect x="' + f(lx - 5) + '" y="' + f(ly - th * (0.72 - i * 0.36)) + '" width="10" height="22" rx="2" fill="' + p.lamp + '" opacity=".9"/>';
    b += birds(r, left ? W * 0.7 : W * 0.3, 240 + r() * 120, p.rock[1]);
    return { d: defs, b: b, name: p.name };
  }

  /* ---------------- 4: peaks above the clouds ---------------- */
  var PEAKS = [
    { name: 'Vrhovi · noć', sky: ['#0b0a3a', '#2a1f6e', '#7a3f9a', '#f06fb5'], star: '#fff6c9', moon: '#5fd6c0', glow: '#4fc7c0', cloudHi: '#3a2f7a', cloudLo: '#f472c0', dark: ['#2a2380', '#1c1a5e', '#12103f'], light: ['#f2d6b0', '#c9a0d8', '#7f6ac0'], fg: '#0b0a2a', stars: 130 },
    { name: 'Vrhovi · led', sky: ['#04142e', '#0e3a6e', '#2f7fb5', '#a8e0ea'], star: '#ffffff', moon: '#eaf6ff', glow: '#9fd6ff', cloudHi: '#123a66', cloudLo: '#bfe6f0', dark: ['#1a4f86', '#123a66', '#0a2647'], light: ['#f4fbff', '#bfe0f2', '#7fb5d8'], fg: '#051628', stars: 110 },
    { name: 'Vrhovi · zora', sky: ['#1a1440', '#5a2f7a', '#e0607a', '#ffb07a'], star: '#fff0d6', moon: '#ffe6b8', glow: '#ffb38a', cloudHi: '#4a2a6e', cloudLo: '#ff9a8a', dark: ['#5a2f6e', '#3f2258', '#2a173f'], light: ['#ffe0b0', '#f2a08a', '#b0607f'], fg: '#160c26', stars: 70 }
  ];
  function peaks(r) {
    var p = pick(r, PEAKS), i, defs = grad('sky', p.sky) + glowDef('glow', p.glow, 0.7), b = '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>' + stars(r, p.stars, 760, p.star);
    var mx = 380 + r() * 1160, my = 190 + r() * 110, mr = 95 + r() * 45;
    defs += '<radialGradient id="mn" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="' + mix(p.moon, '#ffffff', 0.45) + '"/><stop offset="1" stop-color="' + mix(p.moon, p.sky[1], 0.35) + '"/></radialGradient>';
    b += '<circle cx="' + f(mx) + '" cy="' + f(my) + '" r="' + f(mr * 3.4) + '" fill="url(#glow)"/><circle cx="' + f(mx) + '" cy="' + f(my) + '" r="' + f(mr) + '" fill="url(#mn)"/>';
    for (i = 0; i < 4; i++) b += puffCloud(r, r() * W, 230 + r() * 240, 260 + r() * 300, p.cloudHi, f(0.75 + r() * 0.2));
    for (i = 0; i < 5; i++) b += puffCloud(r, r() * W, 610 + r() * 130, 300 + r() * 340, p.cloudLo, f(0.8 + r() * 0.2));
    // far small peaks, the main summit, then nearer ranges
    for (i = 0; i < 4; i++) b += peak(r, 150 + i * 520 + (r() - 0.5) * 240, 560 + r() * 90, 200 + r() * 110, 900, mix(p.dark[0], p.cloudLo, 0.25), mix(p.light[1], p.cloudLo, 0.3), mx > W / 2);
    var cx = 700 + r() * 520;
    b += peak(r, cx, 400 + r() * 70, 430 + r() * 90, 1000, p.dark[0], p.light[0], mx > cx);
    b += peak(r, cx - 560 - r() * 160, 620 + r() * 60, 330, 1050, p.dark[1], p.light[1], mx > cx) + peak(r, cx + 560 + r() * 160, 600 + r() * 70, 350, 1050, p.dark[1], p.light[1], mx > cx);
    b += peak(r, cx - 150 + (r() - 0.5) * 240, 760 + r() * 40, 300, 1120, p.dark[2], p.light[2], mx > cx);
    var l = land(ridge(r, 0.55, 128), H + 40, 210, valley(0.7, cx / W));
    b += '<path d="' + l.d + '" fill="' + p.fg + '"/>';
    return { d: defs, b: b, name: p.name };
  }

  var KINDS = [lake, valleyScene, coast, peaks];
  window.DOM_LANDSCAPE = function (seed, kind) {
    var r = rng(seed), k = kind == null ? Math.floor(r() * KINDS.length) : kind, s = KINDS[k](r);
    return { url: svg(s.d, s.b), title: s.name, credit: '', seed: seed, gen: 'vector' };
  };
  window.DOM_LANDSCAPE.kinds = KINDS.length;
})();
