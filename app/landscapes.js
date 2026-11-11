// Dom: illustrated landscapes drawn on the TV itself (no network). window.DOM_LANDSCAPE(seed) -> { url, title }
// Three kinds of scene, each with a few palettes: a lake under the moon, a valley at sunset
// and a coast with a lighthouse. EL holds the small things that populate them (lighthouses, ships, boats, birds, trees, clouds).
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

  /* ---------------- elements: every variant is fn(x, y, size, colours) -> svg ----------------
     colours: d dark silhouette, b body, a accent, l light (lamp, windows), s sail
     size: height for lighthouses and trees, length for ships and boats, wing unit for birds, width for clouds */
  function fm(t) { var a = arguments, i = 1; return t.replace(/%/g, function () { return f(a[i++]); }); }
  function rc(x, y, w, h, fill, rx, o) { return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '"' + (rx ? ' rx="' + f(rx) + '"' : '') + ' fill="' + fill + '"' + (o != null ? ' opacity="' + o + '"' : '') + '/>'; }
  function ci(x, y, rad, fill, o) { return '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rad) + '" fill="' + fill + '"' + (o != null ? ' opacity="' + o + '"' : '') + '/>'; }
  function el(x, y, rx, ry, fill) { return '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" fill="' + fill + '"/>'; }
  function pa(d, fill, o) { return '<path d="' + d + '" fill="' + fill + '"' + (o != null ? ' opacity="' + o + '"' : '') + '/>'; }
  function ln(d, stroke, w, o) { return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + f(w) + '" stroke-linecap="round" stroke-linejoin="round"' + (o != null ? ' opacity="' + o + '"' : '') + '/>'; }
  function halo(x, y, rad, c) { return ci(x, y, rad, c, 0.07) + ci(x, y, rad * 0.6, c, 0.1) + ci(x, y, rad * 0.3, c, 0.16); }

  // gallery, lamp room and roof on top of a tower whose top edge is at `top`
  function lampHead(x, top, tw, h, c, roof) {
    var s = rc(x - tw - h * 0.03, top - h * 0.028, tw * 2 + h * 0.06, h * 0.03, c.d) +
            rc(x - tw * 0.82, top - h * 0.15, tw * 1.64, h * 0.125, c.l) + rc(x - h * 0.006, top - h * 0.15, h * 0.012, h * 0.125, c.d);
    if (roof === 'dome') s += pa(fm('M% %a% % 0 0 1 % 0Z', x - tw * 0.95, top - h * 0.15, tw * 0.95, tw * 0.95, tw * 1.9), c.d) + rc(x - h * 0.006, top - h * 0.15 - tw * 0.95 - h * 0.03, h * 0.012, h * 0.04, c.d);
    else if (roof === 'flat') s += rc(x - tw * 1.1, top - h * 0.172, tw * 2.2, h * 0.024, c.d) + ci(x, top - h * 0.19, h * 0.016, c.d);
    else s += pa(fm('M% %h%L% %Z', x - tw * 1.04, top - h * 0.15, tw * 2.08, x, top - h * 0.235), c.d);
    return s;
  }
  function tower(x, y, bw, tw, th, fill) { return pa(fm('M% %L% %h%L% %Z', x - bw, y, x - tw, y - th, tw * 2, x + bw, y), fill); }
  function win(x, y, h, c) { return rc(x - h * 0.016, y, h * 0.032, h * 0.065, c.l, h * 0.008); }

  var LIGHTHOUSE = [
    function (x, y, h, c) {   // L1 classic tapered tower, cone roof
      var bw = h * 0.105, tw = h * 0.072, th = h * 0.76;
      return halo(x, y - th - h * 0.09, h * 0.5, c.l) + tower(x, y, bw, tw, th, c.b) + lampHead(x, y - th, tw, h, c) + win(x, y - th * 0.74, h, c) + win(x, y - th * 0.4, h, c);
    },
    function (x, y, h, c) {   // L2 striped, dome roof
      var bw = h * 0.11, tw = h * 0.07, th = h * 0.76, s = halo(x, y - th - h * 0.09, h * 0.5, c.l), n = 5;
      for (var i = 0; i < n; i++) {
        var w0 = bw + (tw - bw) * i / n, w1 = bw + (tw - bw) * (i + 1) / n, y0 = y - th * i / n, y1 = y - th * (i + 1) / n;
        s += pa(fm('M% %L% %L% %L% %Z', x - w0, y0, x - w1, y1 - 0.5, x + w1, y1 - 0.5, x + w0, y0), i % 2 ? c.a : c.b);
      }
      return s + lampHead(x, y - th, tw, h, c, 'dome') + pa(fm('M% %v%a% % 0 0 1 % 0v%Z', x - h * 0.022, y, -h * 0.06, h * 0.022, h * 0.022, h * 0.044, h * 0.06), c.d);
    },
    function (x, y, h, c) {   // L3 tower with the keeper's house
      var bw = h * 0.1, tw = h * 0.07, th = h * 0.76, hx = x + bw * 0.5, hw = h * 0.44, hh = h * 0.17;
      return halo(x, y - th - h * 0.09, h * 0.5, c.l) +
        rc(hx, y - hh, hw, hh, c.b) + pa(fm('M% %L% %L% %L% %Z', hx, y - hh, hx + h * 0.05, y - hh - h * 0.09, hx + hw - h * 0.05, y - hh - h * 0.09, hx + hw + h * 0.025, y - hh), c.a) +
        rc(hx + hw * 0.66, y - hh - h * 0.14, h * 0.035, h * 0.08, c.d) +
        rc(hx + hw * 0.42, y - hh * 0.72, h * 0.045, h * 0.06, c.l) + rc(hx + hw * 0.7, y - hh * 0.72, h * 0.045, h * 0.06, c.l) +
        tower(x, y, bw, tw, th, c.b) + lampHead(x, y - th, tw, h, c) + win(x, y - th * 0.72, h, c) + win(x, y - th * 0.38, h, c);
    },
    function (x, y, h, c) {   // L4 slim straight column with beams of light
      var tw = h * 0.045, th = h * 0.76, ly = y - th - h * 0.09;
      return pa(fm('M% %L% %L% %Z', x, ly, x - h * 1.25, ly - h * 0.16, x - h * 1.25, ly + h * 0.08), c.l, 0.16) + pa(fm('M% %L% %L% %Z', x, ly, x + h * 1.25, ly - h * 0.08, x + h * 1.25, ly + h * 0.16), c.l, 0.16) +
        halo(x, ly, h * 0.4, c.l) + tower(x, y, h * 0.1, h * 0.07, h * 0.07, c.d) + rc(x - tw, y - th, tw * 2, th - h * 0.06, c.b) +
        rc(x - tw, y - th * 0.62, tw * 2, h * 0.07, c.a) + lampHead(x, y - th, tw * 1.25, h, c, 'flat');
    },
    function (x, y, h, c) {   // L5 stone house with a square tower (an Adriatic "lanterna")
      var hw = h * 0.62, hh = h * 0.22, tw = h * 0.085, th = h * 0.74, s = halo(x, y - th - h * 0.09, h * 0.5, c.l);
      s += rc(x - hw / 2, y - hh, hw, hh, c.b) + pa(fm('M% %L% %L% %L% %Z', x - hw / 2 - h * 0.02, y - hh, x - hw / 2 + h * 0.05, y - hh - h * 0.07, x + hw / 2 - h * 0.05, y - hh - h * 0.07, x + hw / 2 + h * 0.02, y - hh), c.a);
      [-0.23, -0.14, 0.14, 0.23].forEach(function (k) { s += rc(x + h * k - h * 0.018, y - hh * 0.7, h * 0.036, h * 0.07, c.l); });
      return s + rc(x - tw, y - th, tw * 2, th, c.b) + rc(x - tw - h * 0.012, y - th, tw * 2 + h * 0.024, h * 0.02, c.d) +
        lampHead(x, y - th, h * 0.058, h, c, 'dome') + win(x, y - th * 0.82, h, c) + win(x, y - th * 0.58, h, c);
    },
    function (x, y, h, c) {   // L6 small harbour light at the end of a pier
      var py = y - h * 0.07, bw = h * 0.085, tw = h * 0.06, th = h * 0.68, s = halo(x, py - th - h * 0.09, h * 0.42, c.l);
      s += rc(x - h * 1.3, py, h * 1.45, h * 0.05, c.d);
      for (var i = 0; i < 6; i++) s += rc(x - h * 1.25 + i * h * 0.26, py, h * 0.035, h * 0.2, c.d);
      return s + tower(x, py, bw, tw, th, c.a) + rc(x - bw * 0.86, py - th * 0.58, bw * 1.72, th * 0.2, c.b) + lampHead(x, py - th, tw, h, c);
    }
  ];

  function hull(x, y, w, fill) { return pa(fm('M% %L% %Q% % % %L% %Q% % % %Z', x - 0.5 * w, y - 0.075 * w, x + 0.5 * w, y - 0.1 * w, x + 0.43 * w, y, x + 0.28 * w, y, x - 0.4 * w, y, x - 0.49 * w, y, x - 0.5 * w, y - 0.075 * w), fill); }
  var SHIP = [
    function (x, y, w, c) {   // S1 sailing boat: mainsail and jib
      var m = x - 0.03 * w;
      return hull(x, y, w, c.d) + rc(m - 0.007 * w, y - 1.02 * w, 0.014 * w, 0.95 * w, c.d) +
        pa(fm('M% %L% %L% %Q% % % %Z', m - 0.018 * w, y - 0.98 * w, m - 0.018 * w, y - 0.15 * w, m - 0.44 * w, y - 0.15 * w, m - 0.36 * w, y - 0.62 * w, m - 0.018 * w, y - 0.98 * w), c.s) +
        pa(fm('M% %L% %L% %Q% % % %Z', m + 0.02 * w, y - 0.9 * w, m + 0.02 * w, y - 0.14 * w, x + 0.47 * w, y - 0.13 * w, m + 0.22 * w, y - 0.56 * w, m + 0.02 * w, y - 0.9 * w), c.s);
    },
    function (x, y, w, c) {   // S2 tall ship with square sails
      var s = pa(fm('M% %L% %L% %L% %Q% % % %L% %Q% % % %Z', x - 0.5 * w, y - 0.13 * w, x - 0.34 * w, y - 0.085 * w, x + 0.34 * w, y - 0.085 * w, x + 0.5 * w, y - 0.14 * w, x + 0.42 * w, y, x + 0.3 * w, y, x - 0.4 * w, y, x - 0.5 * w, y - 0.02 * w, x - 0.5 * w, y - 0.13 * w), c.d);
      s += ln(fm('M% %L% %', x + 0.48 * w, y - 0.13 * w, x + 0.72 * w, y - 0.22 * w), c.d, 0.012 * w);
      [[-0.27, 0.62], [0, 0.74], [0.25, 0.6]].forEach(function (m) {
        var mx = x + m[0] * w, k = m[1] / 0.74;
        s += rc(mx - 0.006 * w, y - m[1] * w, 0.012 * w, m[1] * w - 0.08 * w, c.d);
        for (var j = 0; j < 3; j++) {
          var sw = (0.21 - 0.04 * j) * w * k, yb = y - 0.14 * w - j * 0.185 * w * k, yt = yb - 0.155 * w * k;
          s += pa(fm('M% %L% %L% %Q% % % %Z', mx - sw / 2, yt, mx + sw / 2, yt, mx + sw * 0.54, yb, mx, yb - 0.035 * w, mx - sw * 0.54, yb), c.s);
        }
      });
      return s + pa(fm('M% %L% %L% %Z', x + 0.27 * w, y - 0.56 * w, x + 0.7 * w, y - 0.215 * w, x + 0.31 * w, y - 0.19 * w), c.s, 0.9) +
        pa(fm('M% %L% %L% %L% %Z', x - 0.29 * w, y - 0.5 * w, x - 0.29 * w, y - 0.16 * w, x - 0.53 * w, y - 0.18 * w, x - 0.47 * w, y - 0.42 * w), c.s, 0.9);
    },
    function (x, y, w, c) {   // S3 cargo ship with a funnel
      var s = pa(fm('M% %L% %L% %L% %L% %L% %Z', x - 0.5 * w, y - 0.085 * w, x + 0.33 * w, y - 0.085 * w, x + 0.36 * w, y - 0.115 * w, x + 0.5 * w, y - 0.115 * w, x + 0.43 * w, y, x - 0.47 * w, y), c.d);
      s += rc(x - 0.44 * w, y - 0.17 * w, 0.2 * w, 0.09 * w, c.d) + rc(x - 0.41 * w, y - 0.225 * w, 0.13 * w, 0.06 * w, c.d) +
        pa(fm('M% %L% %L% %L% %Z', x - 0.365 * w, y - 0.225 * w, x - 0.35 * w, y - 0.315 * w, x - 0.3 * w, y - 0.315 * w, x - 0.295 * w, y - 0.225 * w), c.d) +
        rc(x - 0.352 * w, y - 0.3 * w, 0.054 * w, 0.024 * w, c.a) + rc(x - 0.42 * w, y - 0.15 * w, 0.16 * w, 0.02 * w, c.l, 0, 0.9) + rc(x - 0.39 * w, y - 0.208 * w, 0.09 * w, 0.018 * w, c.l, 0, 0.9);
      [0.05, 0.075, 0.055, 0.07].forEach(function (hh, i) { s += rc(x - 0.19 * w + i * 0.125 * w, y - 0.085 * w - hh * w, 0.11 * w, hh * w, i % 2 ? c.a : c.s, 0, 0.85); });
      return s + rc(x + 0.4 * w, y - 0.26 * w, 0.008 * w, 0.15 * w, c.d) + ci(x - 0.34 * w, y - 0.36 * w, 0.03 * w, c.s, 0.3) + ci(x - 0.39 * w, y - 0.43 * w, 0.045 * w, c.s, 0.2) + ci(x - 0.47 * w, y - 0.5 * w, 0.06 * w, c.s, 0.12);
    },
    function (x, y, w, c) {   // S4 fishing trawler
      return pa(fm('M% %Q% % % %Q% % % %L% %Q% % % %Z', x - 0.5 * w, y - 0.12 * w, x, y - 0.06 * w, x + 0.5 * w, y - 0.2 * w, x + 0.44 * w, y - 0.02 * w, x + 0.3 * w, y, x - 0.42 * w, y, x - 0.5 * w, y, x - 0.5 * w, y - 0.12 * w), c.d) +
        rc(x + 0.02 * w, y - 0.3 * w, 0.2 * w, 0.22 * w, c.d) + rc(x, y - 0.325 * w, 0.24 * w, 0.03 * w, c.d) + rc(x + 0.055 * w, y - 0.27 * w, 0.13 * w, 0.06 * w, c.l) +
        rc(x - 0.126 * w, y - 0.64 * w, 0.012 * w, 0.56 * w, c.d) + ln(fm('M% %L% %', x - 0.12 * w, y - 0.5 * w, x - 0.46 * w, y - 0.3 * w), c.d, 0.012 * w) +
        ln(fm('M% %L% %L% %', x + 0.48 * w, y - 0.19 * w, x - 0.12 * w, y - 0.63 * w, x - 0.48 * w, y - 0.12 * w), c.d, 0.005 * w) + ci(x - 0.12 * w, y - 0.655 * w, 0.014 * w, c.l);
    },
    function (x, y, w, c) {   // S5 motor yacht / small ferry
      return pa(fm('M% %L% %L% %Q% % % %L% %Z', x - 0.5 * w, y - 0.09 * w, x + 0.36 * w, y - 0.09 * w, x + 0.5 * w, y - 0.13 * w, x + 0.44 * w, y - 0.01 * w, x + 0.36 * w, y, x - 0.47 * w, y), c.d) +
        pa(fm('M% %L% %L% %L% %Z', x - 0.42 * w, y - 0.085 * w, x - 0.4 * w, y - 0.17 * w, x + 0.18 * w, y - 0.17 * w, x + 0.28 * w, y - 0.085 * w), c.s) +
        pa(fm('M% %L% %L% %L% %Z', x - 0.33 * w, y - 0.165 * w, x - 0.31 * w, y - 0.235 * w, x + 0.06 * w, y - 0.235 * w, x + 0.13 * w, y - 0.165 * w), c.s) +
        rc(x - 0.37 * w, y - 0.148 * w, 0.52 * w, 0.026 * w, c.l, 0.01 * w) + rc(x - 0.28 * w, y - 0.215 * w, 0.3 * w, 0.022 * w, c.l, 0.01 * w) +
        rc(x - 0.2 * w, y - 0.3 * w, 0.06 * w, 0.065 * w, c.d) + rc(x - 0.06 * w, y - 0.33 * w, 0.008 * w, 0.1 * w, c.d);
    }
  ];

  function skiff(x, y, w, fill) { return pa(fm('M% %Q% % % %Q% % % %L% %Q% % % %Z', x - 0.5 * w, y - 0.17 * w, x, y - 0.1 * w, x + 0.5 * w, y - 0.17 * w, x + 0.4 * w, y + 0.01 * w, x + 0.22 * w, y + 0.01 * w, x - 0.22 * w, y + 0.01 * w, x - 0.4 * w, y + 0.01 * w, x - 0.5 * w, y - 0.17 * w), fill); }
  function ripple(x, y, w, c) { return rc(x - 0.42 * w, y + 0.035 * w, 0.84 * w, 0.014 * w, c.d, 0.007 * w, 0.3) + rc(x - 0.24 * w, y + 0.075 * w, 0.48 * w, 0.012 * w, c.d, 0.006 * w, 0.18); }
  function person(px, y, w, c) { return rc(px - 0.035 * w, y - 0.27 * w, 0.07 * w, 0.2 * w, c.d, 0.03 * w) + ci(px, y - 0.315 * w, 0.036 * w, c.d); }
  var BOAT = [
    function (x, y, w, c) {   // B1 empty rowing boat with oars
      return skiff(x, y, w, c.d) + ln(fm('M% %L% %', x - 0.04 * w, y - 0.15 * w, x - 0.36 * w, y + 0.09 * w), c.d, 0.018 * w) + ln(fm('M% %L% %', x + 0.08 * w, y - 0.15 * w, x + 0.4 * w, y + 0.07 * w), c.d, 0.018 * w) + ripple(x, y, w, c);
    },
    function (x, y, w, c) {   // B2 canoe with a paddler
      var px = x - 0.08 * w;
      return pa(fm('M% %Q% % % %L% %Q% % % %Q% % % %L% %Q% % % %Z', x - 0.5 * w, y - 0.13 * w, x - 0.44 * w, y - 0.07 * w, x - 0.3 * w, y - 0.07 * w, x + 0.3 * w, y - 0.07 * w, x + 0.44 * w, y - 0.07 * w, x + 0.5 * w, y - 0.13 * w, x + 0.4 * w, y + 0.01 * w, x + 0.2 * w, y + 0.01 * w, x - 0.2 * w, y + 0.01 * w, x - 0.4 * w, y + 0.01 * w, x - 0.5 * w, y - 0.13 * w), c.d) +
        person(px, y, w, c) + ln(fm('M% %L% %', px - 0.05 * w, y - 0.38 * w, px + 0.2 * w, y + 0.03 * w), c.d, 0.014 * w) + el(px + 0.215 * w, y + 0.055 * w, 0.022 * w, 0.045 * w, c.d) +
        ln(fm('M% %L% %', px, y - 0.22 * w, px + 0.09 * w, y - 0.17 * w), c.d, 0.022 * w) + ripple(x, y, w, c);
    },
    function (x, y, w, c) {   // B3 small boat with a lateen sail (gajeta)
      return skiff(x, y, w, c.d) + rc(x - 0.008 * w, y - 0.66 * w, 0.016 * w, 0.54 * w, c.d) +
        pa(fm('M% %L% %Q% % % %Q% % % %Z', x + 0.42 * w, y - 0.24 * w, x - 0.22 * w, y - 0.92 * w, x - 0.27 * w, y - 0.5 * w, x - 0.4 * w, y - 0.2 * w, x, y - 0.3 * w, x + 0.42 * w, y - 0.24 * w), c.s) +
        ln(fm('M% %L% %', x + 0.44 * w, y - 0.22 * w, x - 0.24 * w, y - 0.94 * w), c.d, 0.014 * w) + ripple(x, y, w, c);
    },
    function (x, y, w, c) {   // B4 boat moored at a jetty
      var s = rc(x - 0.95 * w, y - 0.2 * w, 0.8 * w, 0.035 * w, c.d);
      [-0.9, -0.64, -0.38, -0.18].forEach(function (k, i) { s += rc(x + k * w, y - (i === 3 ? 0.3 : 0.2) * w, 0.03 * w, (i === 3 ? 0.42 : 0.32) * w, c.d); });
      return s + skiff(x + 0.24 * w, y, 0.7 * w, c.d) + ln(fm('M% %Q% % % %', x - 0.165 * w, y - 0.24 * w, x - 0.14 * w, y - 0.08 * w, x - 0.1 * w, y - 0.12 * w), c.d, 0.008 * w) + ripple(x + 0.24 * w, y, 0.7 * w, c);
    },
    function (x, y, w, c) {   // B5 angler in a boat
      var px = x - 0.16 * w;
      return skiff(x, y, w, c.d) + person(px, y, w, c) + pa(fm('M% %L% %L% %Z', px - 0.07 * w, y - 0.335 * w, px, y - 0.39 * w, px + 0.07 * w, y - 0.335 * w), c.d) +
        ln(fm('M% %L% %', px, y - 0.22 * w, px + 0.08 * w, y - 0.2 * w), c.d, 0.022 * w) +
        ln(fm('M% %Q% % % %', px + 0.07 * w, y - 0.2 * w, px + 0.34 * w, y - 0.7 * w, px + 0.66 * w, y - 0.52 * w), c.d, 0.01 * w) +
        ln(fm('M% %L% %', px + 0.66 * w, y - 0.52 * w, px + 0.66 * w, y + 0.03 * w), c.d, 0.004 * w, 0.7) + ripple(x, y, w, c);
    }
  ];

  // one bird of each kind; flocks are made by the caller
  var BIRD = [
    function (x, y, k, c) {   // P1 two arcs, drawn with a line
      return ln(fm('M% %q% % % %q% % % %', x - k * 2, y - k * 0.3, k, -k * 0.6, k * 2, k * 0.5, k, -k * 1.1, k * 2, -k * 0.5), c.d, k * 0.28);
    },
    function (x, y, k, c) {   // P2 gull, filled
      return pa(fm('M% %Q% % % %Q% % % %Q% % % %Q% % % %Z', x - 2 * k, y - 0.25 * k, x - k, y - 1.15 * k, x, y - 0.05 * k, x + k, y - 1.15 * k, x + 2 * k, y - 0.25 * k, x + k, y - 0.6 * k, x, y + 0.4 * k, x - k, y - 0.6 * k, x - 2 * k, y - 0.25 * k), c.d);
    },
    function (x, y, k, c) {   // P3 a V of distant geese (the whole formation)
      var s = '';
      for (var i = -4; i <= 4; i++) {
        var a = Math.abs(i), bx = x + i * k * 1.5, by = y + a * k * 0.85 + (a % 2) * k * 0.12, u = k * 0.42;
        s += ln(fm('M% %Q% % % %Q% % % %', bx - u * 1.6, by - u * 0.5, bx - u * 0.7, by - u * 0.9, bx, by, bx + u * 0.7, by - u * 0.9, bx + u * 1.6, by - u * 0.5), c.d, u * 0.42);
      }
      return s;
    },
    function (x, y, k, c) {   // P4 a soaring bird of prey, close
      var h = function (m) {
        return fm('C% % % % % %L% %L% %L% %L% %L% %L% %C% % % % % %L% %', x + m * 0.3 * k, y - 0.32 * k, x + m * 1.2 * k, y - 0.78 * k, x + m * 3 * k, y - 0.95 * k,
          x + m * 3.12 * k, y - 0.62 * k, x + m * 2.72 * k, y - 0.55 * k, x + m * 3 * k, y - 0.3 * k, x + m * 2.52 * k, y - 0.28 * k, x + m * 2.7 * k, y - 0.02 * k, x + m * 2.2 * k, y - 0.08 * k,
          x + m * 1.4 * k, y + 0.1 * k, x + m * 0.7 * k, y + 0.15 * k, x + m * 0.32 * k, y + 0.35 * k, x + m * 0.46 * k, y + 0.98 * k);
      };
      return pa(fm('M% %', x, y - 0.3 * k) + h(1) + fm('L% %Z', x, y + 0.8 * k), c.d) + pa(fm('M% %', x, y - 0.3 * k) + h(-1) + fm('L% %Z', x, y + 0.8 * k), c.d) + ci(x, y - 0.3 * k, 0.17 * k, c.d);
    },
    function (x, y, k, c) {   // P5 swallow with a forked tail
      return pa(fm('M% %Q% % % %Q% % % %L% %L% %L% %L% %Q% % % %Q% % % %Z', x, y - 0.35 * k, x + 0.9 * k, y - 0.95 * k, x + 2.1 * k, y - 0.1 * k, x + 1.05 * k, y - 0.42 * k, x + 0.28 * k, y + 0.1 * k,
        x + 0.5 * k, y + 1.15 * k, x, y + 0.5 * k, x - 0.5 * k, y + 1.15 * k, x - 0.28 * k, y + 0.1 * k, x - 1.05 * k, y - 0.42 * k, x - 2.1 * k, y - 0.1 * k, x - 0.9 * k, y - 0.95 * k, x, y - 0.35 * k), c.d);
    }
  ];

  var TREE = [
    function (x, y, h, c) { return pine(x, y, h, c.d); },   // T1 pine in tiers
    function (x, y, h, c) {   // T2 slim fir with a saw-tooth outline
      var n = 8, L = '', R = [], i;
      for (i = 1; i <= n; i++) {
        var w = h * 0.17 * i / n, yy = y - h * 0.94 + h * 0.86 * i / n;
        L += 'L' + f(x - w) + ' ' + f(yy) + 'L' + f(x - w * 0.5) + ' ' + f(yy - h * 0.015);
        R.push('L' + f(x + w * 0.5) + ' ' + f(yy - h * 0.015) + 'L' + f(x + w) + ' ' + f(yy));
      }
      return rc(x - h * 0.014, y - h * 0.1, h * 0.028, h * 0.1 + 6, c.d) + pa('M' + f(x) + ' ' + f(y - h) + L + R.reverse().join('') + 'Z', c.d);
    },
    function (x, y, h, c) {   // T3 round-crowned deciduous tree
      return pa(fm('M% %L% %L% %L% %Z', x - h * 0.045, y + 4, x - h * 0.025, y - h * 0.5, x + h * 0.025, y - h * 0.5, x + h * 0.045, y + 4), c.d) +
        ln(fm('M% %L% %M% %L% %', x, y - h * 0.36, x - h * 0.16, y - h * 0.52, x, y - h * 0.3, x + h * 0.17, y - h * 0.5), c.d, h * 0.022) +
        ci(x, y - h * 0.68, h * 0.26, c.d) + ci(x - h * 0.2, y - h * 0.56, h * 0.19, c.d) + ci(x + h * 0.2, y - h * 0.57, h * 0.2, c.d) + ci(x - h * 0.09, y - h * 0.82, h * 0.17, c.d) + ci(x + h * 0.11, y - h * 0.81, h * 0.16, c.d);
    },
    function (x, y, h, c) {   // T4 cypress
      return rc(x - h * 0.012, y - h * 0.1, h * 0.024, h * 0.1 + 6, c.d) + pa(fm('M% %C% % % % % %C% % % % % %Z', x, y - h, x + h * 0.13, y - h * 0.7, x + h * 0.12, y - h * 0.2, x, y - h * 0.07, x - h * 0.12, y - h * 0.2, x - h * 0.13, y - h * 0.7, x, y - h), c.d);
    },
    function (x, y, h, c) {   // T5 umbrella pine of the coast
      return ln(fm('M% %Q% % % %', x, y + 4, x - h * 0.05, y - h * 0.4, x + h * 0.06, y - h * 0.76), c.d, h * 0.04) +
        ln(fm('M% %Q% % % %M% %Q% % % %', x + h * 0.01, y - h * 0.55, x - h * 0.08, y - h * 0.7, x - h * 0.16, y - h * 0.8, x + h * 0.04, y - h * 0.62, x + h * 0.16, y - h * 0.72, x + h * 0.22, y - h * 0.82), c.d, h * 0.022) +
        el(x + h * 0.04, y - h * 0.83, h * 0.36, h * 0.1, c.d) + el(x - h * 0.15, y - h * 0.87, h * 0.21, h * 0.085, c.d) + el(x + h * 0.21, y - h * 0.89, h * 0.2, h * 0.08, c.d) + el(x + h * 0.03, y - h * 0.93, h * 0.22, h * 0.07, c.d);
    },
    function (x, y, h, c) {   // T6 bare branching tree
      var d = [], grow = function (px, py, ang, len, wd, depth, sway) {
        var ex = px + Math.sin(ang) * len, ey = py - Math.cos(ang) * len;
        d.push(ln(fm('M% %L% %', px, py, ex, ey), c.d, wd));
        if (depth < 1) return;
        grow(ex, ey, ang - 0.42 - sway * 0.1, len * 0.72, wd * 0.66, depth - 1, -sway);
        grow(ex, ey, ang + 0.36 + sway * 0.12, len * 0.74, wd * 0.66, depth - 1, sway);
        if (depth > 2) grow(ex, ey, ang + sway * 0.06, len * 0.5, wd * 0.5, depth - 2, -sway);
      };
      grow(x, y + 4, 0.03, h * 0.3, h * 0.045, 5, 1);
      return d.join('');
    },
    function (x, y, h, c) {   // T7 poplar
      return rc(x - h * 0.014, y - h * 0.14, h * 0.028, h * 0.14 + 6, c.d) + el(x, y - h * 0.53, h * 0.1, h * 0.47, c.d) + el(x - h * 0.035, y - h * 0.4, h * 0.085, h * 0.3, c.d) + el(x + h * 0.04, y - h * 0.45, h * 0.075, h * 0.3, c.d);
    }
  ];

  var CLOUD = [
    function (x, y, w, c, o, r) {   // O1 long soft band
      var h = w * (0.045 + (r ? r() : 0.5) * 0.05), x0 = x - w / 2;
      return pa(fm('M% %Q% % % %T% %Z', x0, y, x0 + w * 0.3, y - h, x0 + w * 0.6, y - h * 0.4, x0 + w, y), c, o);
    },
    function (x, y, w, c, o, r) {   // O2 thin streaks
      var s = '', rows = [[-0.5, 0.62, 0], [-0.3, 0.8, 1], [-0.42, 0.5, 2], [-0.12, 0.6, 3], [-0.34, 0.36, 4]];
      rows.forEach(function (q) { var j = r ? (r() - 0.5) * 0.12 : 0; s += rc(x + (q[0] + j) * w, y + q[2] * w * 0.034, q[1] * w, w * 0.016, c, w * 0.008, o); });
      return s;
    },
    function (x, y, w, c, o) {   // O3 lens-shaped wisps
      var one = function (cx, cy, ww, hh) { return pa(fm('M% %Q% % % %Q% % % %Z', cx - ww / 2, cy, cx, cy - hh, cx + ww / 2, cy, cx, cy + hh * 0.4, cx - ww / 2, cy), c, o); };
      return one(x, y, w, w * 0.11) + one(x + w * 0.22, y + w * 0.05, w * 0.7, w * 0.07) + one(x - w * 0.26, y + w * 0.075, w * 0.5, w * 0.05);
    }
  ];
  var EL = { lighthouse: LIGHTHOUSE, ship: SHIP, boat: BOAT, bird: BIRD, tree: TREE, cloud: CLOUD };

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
    for (i = 0; i < 6; i++) b += EL.cloud[0](r() * W, 110 + i * 62 + r() * 40, 700 + r() * 900, p.cloud, f(0.3 + r() * 0.3), r);
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

  var KINDS = [lake, valleyScene, coast];
  window.DOM_LANDSCAPE = function (seed, kind) {
    var r = rng(seed), k = kind == null ? Math.floor(r() * KINDS.length) : kind, s = KINDS[k](r);
    return { url: svg(s.d, s.b), title: s.name, credit: '', seed: seed, gen: 'vector' };
  };
  window.DOM_LANDSCAPE.kinds = KINDS.length;
  window.DOM_LANDSCAPE.elements = EL;
})();
