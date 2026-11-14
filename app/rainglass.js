// Dom: the weather over the picture, drawn with WebGL. window.DOM_RAIN
//
// Clouds (overcast, broken, storm), fog that thickens with distance, lightning (strikes and flashes
// inside the clouds) and rain on the window: all computed per pixel over whatever picture is behind.
//
// The picture behind the glass is blurred and misted; drops act as small lenses (a sharp, shifted bit
// of the picture inside each, a soft rim, a small highlight); now and then a drop gets heavy and runs
// down, picking up the drops in its way, leaving beads behind and a clearer trail that mists over again.
//
// Everything that moves lives in three textures on the graphics chip (the drops that sit still, the
// trail, the water of this frame); the main thread only moves a few running drops around.
//   DOM_RAIN.supported()                     WebGL is there
//   DOM_RAIN.mount(canvas)                   draw into this canvas
//   DOM_RAIN.set({ glass, kind, sky, fog, lightning, animated, grade })
//        glass: rain on the window; kind: drizzle | rain | heavy; sky: '' | overcast | part | storm; fog: 0..2
//   DOM_RAIN.image(img, alignY)              the picture behind the glass (0 = top, 0.5 = centre); false if it could not be used
//   DOM_RAIN.flash()                         a lightning flash, seen through the glass
//   DOM_RAIN.stop()
(function () {
  'use strict';
  var W = 960, H = 540;          // drawn at half the screen size: the scene is blurred anyway, drops stay crisp enough
  var gl = null, cv = null, P = {}, buf = null, T = {}, F = {};
  var ERR = '', INFO = '';
  var S = { on: false, anim: false, kind: 'rain', grade: [1, 1, 1], haze: 0.12, mix: 1, mixT: 0, hasImg: false,
            heads: [], spawnAt: 0, raf: 0, last: 0, frame: 0, flash: 0,
            glass: true, sky: '', fog: 0, lightning: false, t0: 0, time: 0,
            strike: null, nextStrike: 0, bolt: [0.6, 0.18, 0, 0], boltOn: 0, strikeAt: [0.6, 0.2] };

  /* ---------------- GL plumbing ---------------- */
  var VS = 'attribute vec2 p; uniform vec4 uRect; uniform vec2 uRes; varying vec2 vUv;' +
    'void main(){ vUv = p; vec2 px = uRect.xy + p * uRect.zw; vec2 c = px / uRes * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }';
  var FS_SPRITE = 'precision mediump float; varying vec2 vUv; uniform sampler2D uT; uniform float uA;' +
    'void main(){ vec4 c = texture2D(uT, vUv); gl_FragColor = vec4(c.rgb, c.a * uA); }';
  var FS_COPY = 'precision mediump float; varying vec2 vUv; uniform sampler2D uT;' +
    'void main(){ gl_FragColor = texture2D(uT, vec2(vUv.x, 1.0 - vUv.y)); }';
  var FS_FILL = 'precision mediump float; uniform vec4 uC; void main(){ gl_FragColor = uC; }';
  var FS_FINAL = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uSharpA, uBlurA, uSharpB, uBlurB, uWater, uTrail, uNoise, uBolt;',
    'uniform float uMix, uHaze, uFlash, uGlass, uTime, uCloud, uCov, uShadow, uFog, uBoltOn;',
    'uniform vec3 uGrade, uCloudBase, uCloudTop;',
    'uniform vec2 uPx, uFade, uStrike;',
    'uniform vec4 uBoltRect;',
    'vec3 sharp(vec2 uv){ return mix(texture2D(uSharpA, uv).rgb, texture2D(uSharpB, uv).rgb, uMix); }',
    'vec3 blr(vec2 uv){ return mix(texture2D(uBlurA, uv).rgb, texture2D(uBlurB, uv).rgb, uMix); }',
    'vec3 blurred(vec2 uv){ vec2 o = uPx * 0.8; return (blr(uv + vec2(o.x, o.y)) + blr(uv + vec2(-o.x, o.y)) + blr(uv + vec2(o.x, -o.y)) + blr(uv - o)) * 0.25; }',
    'vec3 graded(vec3 c){ float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uGrade.x); c = (c - 0.5) * uGrade.z + 0.5; return c * uGrade.y; }',
    'void main(){',
    '  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);',
    '  float y = vUv.y;',
    // ---- the sky: a deck of clouds coming down from the top, lit from above ----
    '  float ca = 0.0, cdens = 0.0, clit = 0.5; vec3 ccol = vec3(0.0);',
    '  if (uCloud > 0.0) {',
    '    vec2 cuv = vec2(vUv.x * 1.3, vUv.y * 0.75);',
    '    vec2 warp = (texture2D(uNoise, cuv * 0.6 + vec2(uTime * 0.0021, uTime * 0.0007)).gb - 0.5) * 0.42;',
    '    vec2 p = cuv + warp + vec2(uTime * 0.0065, 0.0);',
    '    float d = texture2D(uNoise, p).r;',
    '    float dl = texture2D(uNoise, p + vec2(-0.012, -0.034)).r;',
    '    cdens = smoothstep(1.0 - uCov - 0.1, 1.0 - uCov + 0.3, d);',
    '    clit = clamp(0.55 + (d - dl) * 6.0, 0.0, 1.0) * 0.75 + smoothstep(0.3, 0.9, d) * 0.25;',
    '    ccol = mix(uCloudBase, uCloudTop, clit);',
    '    ca = cdens * smoothstep(uFade.x, uFade.y, y) * uCloud;',
    '  }',
    // ---- the picture through the (misted) glass ----
    '  vec3 sh = sharp(vUv);',
    '  vec3 back = sh;',
    '  vec4 w = vec4(0.5, 0.5, 0.0, 0.0);',
    '  vec3 mist = vec3(0.80, 0.83, 0.87);',
    '  if (uGlass > 0.5) {',
    '    w = texture2D(uWater, fuv);',
    '    float tr = texture2D(uTrail, fuv).a;',
    '    back = mix(blurred(vUv) * (1.0 - uHaze) + mist * uHaze, sh * 0.93, clamp(tr * 1.1, 0.0, 0.9));',
    '  }',
    '  vec2 n = (w.rg - 0.5) * 2.0;',
    '  float a = uGlass > 0.5 ? smoothstep(0.08, 0.55, w.a) : 0.0;',
    '  vec3 scene = back;',
    '  if (a > 0.0) {',
    '    vec2 ruv = clamp(vUv + n * 0.028 - vec2(0.0, w.b * 0.01), 0.0, 1.0);',
    '    vec3 lens = sharp(ruv) * 0.8 + blurred(ruv) * 0.2;',
    '    lens = lens * 1.05 * (1.0 - uHaze * 0.5) + mist * uHaze * 0.5;',
    '    float nz = sqrt(clamp(1.0 - dot(n, n), 0.0, 1.0));',
    '    float rim = pow(1.0 - nz, 2.0);',
    '    float spec = pow(max(dot(vec3(n, nz), normalize(vec3(-0.45, -0.6, 0.66))), 0.0), 90.0) * 0.5;',
    '    scene = mix(back, lens * (1.0 - rim * 0.25) + spec + lens * pow(clamp(n.y, 0.0, 1.0), 2.0) * 0.12, a);',
    '  }',
    // ---- the light of the day: graded, clouds over it, their shadows drifting over the land ----
    '  vec3 c = graded(scene);',
    '  if (uCloud > 0.0) {',
    '    float s = texture2D(uNoise, vUv * vec2(0.55, 0.35) + vec2(uTime * 0.004, uTime * 0.0012)).a;',
    '    c *= 1.0 - smoothstep(0.42, 0.62, s) * uShadow * (1.0 - ca * 0.6);',
    '    c = mix(c, ccol, ca * (1.0 - a * 0.5));',
    '  }',
    // ---- fog: thicker with distance (the horizon), banks rolling, lying low in the valley ----
    '  if (uFog > 0.0) {',
    '    float h = 0.62;',
    '    float depth = y < h ? 1.0 : 1.0 - (y - h) / (1.0 - h) * 0.92;',
    '    float banks = texture2D(uNoise, vUv * vec2(0.9, 0.55) + vec2(uTime * 0.0045, uTime * 0.001)).a;',
    '    float valley = exp(-pow((y - h - 0.06) / 0.11, 2.0));',
    '    float dens = uFog * (0.55 + 0.9 * banks) * (0.75 + 0.6 * valley);',
    '    float f = clamp(1.0 - exp(-dens * depth * 2.2) + valley * banks * 0.35 * uFog, 0.0, 0.97);',
    '    vec3 fogc = vec3(0.80, 0.82, 0.84);',
    '    float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '    c = mix(mix(vec3(l), c, 0.75), fogc, f);',
    '    vec3 bl = blurred(vUv);',
    '    c += vec3(1.0, 0.98, 0.94) * max(dot(bl, vec3(0.299, 0.587, 0.114)) - 0.86, 0.0) * 1.6 * min(uFog, 1.0);',   // only bright lights glow through the fog, white
    '  }',
    // ---- lightning: the cloud lit from inside, the land for an instant, the bolt itself ----
    '  if (uFlash > 0.0) {',
    '    vec2 dd = vec2((vUv.x - uStrike.x) / 1.4 * 1.7778, vUv.y - uStrike.y);',
    '    float dist = length(dd);',
    '    float inside = exp(-pow(dist / 0.31, 2.0)) * 0.75 + exp(-pow(dist / 0.93, 2.0)) * 0.28;',
    '    float fade = smoothstep(uFade.x, uFade.y, y);',
    '    vec3 fc = vec3(0.78, 0.82, 1.0);',
    '    c += fc * inside * (0.15 + 0.85 * cdens * clit) * max(fade, 0.2) * 0.85 * uFlash;',
    '    c += sh * (1.0 - fade) * (0.12 + 0.35 * exp(-pow((vUv.x - uStrike.x) / 0.31, 2.0))) * fc * 0.9 * uFlash;',
    '    if (uBoltOn > 0.0) {',
    '      vec2 bu = (vUv - uBoltRect.xy) / uBoltRect.zw;',
    '      if (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) {',
    '        float e = texture2D(uBolt, bu).a * smoothstep(uStrike.y - 0.01, uStrike.y + 0.08, y) * (uGlass > 0.5 ? 0.75 : 1.0);',
    '        c += e * vec3(0.82, 0.86, 1.0) * uFlash * 1.6;',
    '      }',
    '    }',
    '  }',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    return p;
  }
  function u(p, name) { return p.u[name] || (p.u[name] = gl.getUniformLocation(p, name)); }
  function texture(w, h, src) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  function target(name) {
    var t = texture(W, H), f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    F[name] = f; T[name] = t;
  }
  function bindTarget(name) { gl.bindFramebuffer(gl.FRAMEBUFFER, name ? F[name] : null); gl.viewport(0, 0, W, H); }
  function quad(p, x, y, w, h) {
    gl.uniform4f(u(p, 'uRect'), x, y, w, h);
    gl.uniform2f(u(p, 'uRes'), W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function use(p) { gl.useProgram(p); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
  function blendNormal() { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
  function blendErase() { gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); }

  /* ---------------- sprites, drawn once on a 2D canvas ---------------- */
  // a drop: its slope in red/green (0.5 = flat), its thickness in blue, its outline in alpha
  function dropSprite() {
    var n = 64, c = document.createElement('canvas'); c.width = c.height = n;
    var g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var dx = (x + 0.5) / (n / 2) - 1, dy = (y + 0.5) / (n / 2) - 1, rr = Math.sqrt(dx * dx + dy * dy), k = (y * n + x) * 4;
      var z = Math.sqrt(Math.max(0, 1 - rr * rr));
      d[k] = Math.round(128 + dx * 127); d[k + 1] = Math.round(128 + dy * 127); d[k + 2] = Math.round(z * 255);
      d[k + 3] = Math.round(Math.max(0, Math.min(1, (1 - rr) * 9)) * 255);
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function softSprite() {
    var n = 64, c = document.createElement('canvas'); c.width = c.height = n;
    var g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    return c;
  }

  /* ---------------- noise for clouds and fog: four tileable fractal noises, one per channel ---------------- */
  function noiseCanvas() {
    var w = 512, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    var seed = 1;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var chans = [[5, 4, 2], [3, 4, 2], [3, 4, 2], [2, 5, 3]].map(function (cfg, ch) {
      var oct = [], cx = cfg[0], tot = 0, o;
      for (o = 0; o < cfg[1]; o++) {
        var gw = cx << o, gh = Math.max(2, (cx << o) >> 1), grid = new Float32Array(gw * gh);
        for (var i = 0; i < grid.length; i++) grid[i] = rnd();
        oct.push({ gw: gw, gh: gh, g: grid, amp: Math.pow(0.5, o) }); tot += Math.pow(0.5, o);
      }
      return { oct: oct, tot: tot };
    });
    var sm = function (t) { return t * t * (3 - 2 * t); };
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      for (var ch = 0; ch < 4; ch++) {
        var v = 0, q = chans[ch];
        for (var k = 0; k < q.oct.length; k++) {
          var e = q.oct[k], fx = x / w * e.gw, fy = y / h * e.gh, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
          var x1 = (x0 + 1) % e.gw, y1 = (y0 + 1) % e.gh;   // wraps: the texture repeats without a seam
          var a0 = e.g[y0 * e.gw + x0] + (e.g[y0 * e.gw + x1] - e.g[y0 * e.gw + x0]) * tx;
          var a1 = e.g[y1 * e.gw + x0] + (e.g[y1 * e.gw + x1] - e.g[y1 * e.gw + x0]) * tx;
          v += e.amp * (a0 + (a1 - a0) * ty);
        }
        d[(y * w + x) * 4 + ch] = Math.round(v / q.tot * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // a lightning bolt: a jagged channel heading down with branches that thin out; core and glow in alpha
  function boltCanvas(seed) {
    var w = 360, h = 640, c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'), st = seed * 9301 + 49297;
    var r = function () { st = (st * 9301 + 49297) % 233280; return st / 233280; };
    var gauss = function () { return (r() + r() + r() - 1.5) * 1.15; };
    var segs = [];
    function grow(x, y, ang, len, width, depth, bright) {
      var steps = Math.floor(len / 7), pts = [[x, y]];
      for (var i = 0; i < steps; i++) {
        ang += gauss() * 0.34; ang = Math.max(-1.2, Math.min(1.2, ang * 0.92));
        x += Math.sin(ang) * 7; y += Math.cos(ang) * 7;
        pts.push([x, y]);
        if (depth < 3 && r() < (depth ? 0.05 : 0.085)) grow(x, y, ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), len * (0.2 + r() * 0.25) * (1 - i / steps), width * 0.55, depth + 1, bright * 0.6);
        if (y > h - 6) break;
      }
      segs.push([pts, width, bright]);
    }
    grow(w / 2 + (r() - 0.5) * 40, 4, gauss() * 0.2, h * 1.2, 3.2, 0, 1);
    var draw = function (blur, scale, alpha) {
      g.save();
      g.shadowColor = 'rgba(255,255,255,' + alpha + ')'; g.shadowBlur = blur;
      segs.forEach(function (sg) {
        g.strokeStyle = 'rgba(255,255,255,' + (sg[2] * alpha) + ')'; g.lineWidth = Math.max(0.8, sg[1] * scale); g.lineJoin = 'round'; g.lineCap = 'round';
        g.beginPath(); sg[0].forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
      });
      g.restore();
    };
    draw(40, 4, 0.18); draw(14, 2, 0.4); draw(4, 1, 1);
    return c;
  }

  /* ---------------- the picture behind the glass ---------------- */
  var SHARP = null, BLUR = null;
  function prepare(img, alignY) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return false;
    if (!SHARP) { SHARP = document.createElement('canvas'); SHARP.width = W; SHARP.height = H; BLUR = document.createElement('canvas'); BLUR.width = 240; BLUR.height = 135; }
    // cover the screen the way the background does
    var s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
    var g = SHARP.getContext('2d');
    g.drawImage(img, (W - dw) / 2, (H - dh) * (alignY == null ? 0.5 : alignY), dw, dh);
    // blurred: halved twice, then the GPU's smooth sampling does the rest
    var mid = document.createElement('canvas'); mid.width = 480; mid.height = 270;
    mid.getContext('2d').drawImage(SHARP, 0, 0, 480, 270);
    var b = BLUR.getContext('2d'); b.clearRect(0, 0, 240, 135); b.drawImage(mid, 0, 0, 240, 135);
    return true;
  }

  /* ---------------- the water ---------------- */
  var R = Math.random;
  function drawDrop(x, y, r, a) { quad(P.sprite, x - r, y - r * 1.12, r * 2, r * 2.3); }
  function seedDrops() {
    bindTarget('still'); gl.clearColor(0.5, 0.5, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    use(P.sprite); blendNormal();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.drop); gl.uniform1i(u(P.sprite, 'uT'), 0); gl.uniform1f(u(P.sprite, 'uA'), 1);
    var k = S.kind, small = k === 'heavy' ? 1700 : (k === 'drizzle' ? 1000 : 900), big = k === 'heavy' ? 110 : (k === 'drizzle' ? 55 : 80);
    for (var i = 0; i < small; i++) drawDrop(R() * W, R() * H, 0.8 + Math.pow(R(), 2.4) * 2.9);
    for (i = 0; i < big; i++) drawDrop(R() * W, R() * H, 3.6 + Math.pow(R(), 2) * 8);
    bindTarget('trail'); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    S.heads = []; S.spawnAt = 0;
  }
  function spawnHead(now) {
    var k = S.kind, max = k === 'heavy' ? 7 : (k === 'drizzle' ? 0 : 4);
    if (S.heads.length >= max || now < S.spawnAt) return;
    S.spawnAt = now + (k === 'heavy' ? 900 : 2200) * (0.5 + R());
    S.heads.push(newHead(R() * H * 0.45, 0.4));
  }
  function newHead(y, vy) { return { x: 20 + R() * (W - 40), y: y, r: 4.5 + R() * 3, vy: vy, stick: 0, ang: (R() - 0.5) * 0.5, turn: 0 }; }
  // a running drop: it speeds up and slows down, sometimes sticks and then breaks away in a new direction,
  // its heading drifts (sideways runs, zigzags), it grows as it picks drops up
  function stepHeads(steps) {
    var still = [], trail = [], beads = [];
    for (var s = 0; s < steps; s++) {
      for (var i = S.heads.length - 1; i >= 0; i--) {
        var h = S.heads[i];
        if (h.stick > 0) { h.stick--; continue; }
        h.vy = Math.max(0.25, Math.min(3.6, h.vy + (R() - 0.42) * 0.5));
        // the heading wanders and is pulled back towards straight down; now and then it kinks
        h.turn = h.turn * 0.9 + (R() - 0.5) * 0.09;
        h.ang = Math.max(-1.0, Math.min(1.0, h.ang * 0.985 + h.turn));
        if (R() < 0.012) h.ang += (R() < 0.5 ? -1 : 1) * (0.35 + R() * 0.5);
        var step = h.vy * (0.55 + h.r / 9), dy = step * Math.cos(h.ang);
        h.y += dy; h.x += step * Math.sin(h.ang) * 1.3 + (R() - 0.5) * 0.5;
        if (h.x < 6 || h.x > W - 6) h.ang = -h.ang * 0.5;
        h.r = Math.min(10, h.r + 0.015);
        if (R() < 0.008) {   // it sticks; when it breaks away it often goes off at an angle
          h.stick = 6 + Math.floor(R() * 30);
          h.ang = (R() - 0.5) * 1.4; h.vy = 0.3;
        }
        still.push([h.x, h.y, h.r * 1.2]);
        // the water it leaves behind: a thin beaded channel just above it
        if (R() < 0.7) beads.push([h.x + (R() - 0.5) * h.r * 0.35, h.y - h.r * (1.65 + R() * 0.3), h.r * (0.3 + R() * 0.18)]);
        trail.push([h.x, h.y - dy / 2, h.r * 1.5, Math.max(dy, 1)]);
        if (R() < 0.04) beads.push([h.x + (R() - 0.5) * h.r * 0.6, h.y - h.r * (1.8 + R()), h.r * (0.45 + R() * 0.25)]);
        if (h.y > H + h.r * 3) S.heads.splice(i, 1);
      }
    }
    // the drops it ran through are gone (into the running drop)
    bindTarget('still'); use(P.sprite); blendErase();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.soft); gl.uniform1i(u(P.sprite, 'uT'), 0); gl.uniform1f(u(P.sprite, 'uA'), 1);
    still.forEach(function (e) { quad(P.sprite, e[0] - e[2], e[1] - e[2], e[2] * 2, e[2] * 2); });
    // beads left behind
    blendNormal(); gl.bindTexture(gl.TEXTURE_2D, T.drop);
    beads.forEach(function (b) { drawDrop(b[0], b[1], b[2]); });
    // the wiped trail
    bindTarget('trail'); blendNormal(); gl.bindTexture(gl.TEXTURE_2D, T.soft); gl.uniform1f(u(P.sprite, 'uA'), 0.9);
    trail.forEach(function (t) { quad(P.sprite, t[0] - t[2], t[1] - t[2] - t[3] / 2, t[2] * 2, t[2] * 2 + t[3]); });
  }
  function fadeTrail() {   // the mist comes back over the trail, slowly
    bindTarget('trail'); use(P.fill); blendErase();
    gl.uniform4f(u(P.fill, 'uC'), 0, 0, 0, 0.035);
    quad(P.fill, 0, 0, W, H);
  }
  function composeWater() {
    bindTarget('water'); gl.disable(gl.BLEND);
    use(P.copy); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.still); gl.uniform1i(u(P.copy, 'uT'), 0);
    quad(P.copy, 0, 0, W, H);
    if (!S.heads.length) return;
    use(P.sprite); blendNormal(); gl.bindTexture(gl.TEXTURE_2D, T.drop); gl.uniform1i(u(P.sprite, 'uT'), 0); gl.uniform1f(u(P.sprite, 'uA'), 1);
    S.heads.forEach(function (h) { quad(P.sprite, h.x - h.r, h.y - h.r * 1.35, h.r * 2, h.r * 2.6); });
  }
  function final() {
    bindTarget(null); gl.disable(gl.BLEND);
    var p = P.final; use(p);
    [['uSharpA', T.sharpA], ['uBlurA', T.blurA], ['uSharpB', T.sharpB], ['uBlurB', T.blurB], ['uWater', T.water], ['uTrail', T.trail], ['uNoise', T.noise], ['uBolt', T.bolts[S.boltN || 0]]].forEach(function (x, i) {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, x[1]); gl.uniform1i(u(p, x[0]), i);
    });
    gl.uniform1f(u(p, 'uMix'), S.mix); gl.uniform1f(u(p, 'uHaze'), S.haze); gl.uniform1f(u(p, 'uFlash'), S.flash);
    gl.uniform3f(u(p, 'uGrade'), S.grade[0], S.grade[1], S.grade[2]);
    gl.uniform2f(u(p, 'uPx'), 1 / 240, 1 / 135);
    var sky = SKY[S.sky] || SKY[''];
    gl.uniform1f(u(p, 'uGlass'), S.glass ? 1 : 0);
    gl.uniform1f(u(p, 'uTime'), S.time);
    gl.uniform1f(u(p, 'uCloud'), sky.amt); gl.uniform1f(u(p, 'uCov'), sky.cov); gl.uniform1f(u(p, 'uShadow'), sky.shadow);
    gl.uniform3f(u(p, 'uCloudBase'), sky.base[0], sky.base[1], sky.base[2]); gl.uniform3f(u(p, 'uCloudTop'), sky.top[0], sky.top[1], sky.top[2]);
    gl.uniform2f(u(p, 'uFade'), sky.fade[0], sky.fade[1]);
    gl.uniform1f(u(p, 'uFog'), S.fog);
    gl.uniform2f(u(p, 'uStrike'), S.strikeAt[0], S.strikeAt[1]);
    gl.uniform1f(u(p, 'uBoltOn'), S.boltOn);
    gl.uniform4f(u(p, 'uBoltRect'), S.bolt[0], S.bolt[1], S.bolt[2], S.bolt[3]);
    quad(p, 0, 0, W, H);
  }

  // the kinds of sky: how much cloud, how it is coloured, how far down it reaches, how strong its shadows are
  var SKY = {
    '':       { amt: 0, cov: 0, shadow: 0, base: [0, 0, 0], top: [0, 0, 0], fade: [0.6, 0.05] },
    overcast: { amt: 0.95, cov: 0.82, shadow: 0.12, base: [0.56, 0.58, 0.62], top: [0.79, 0.81, 0.84], fade: [0.62, 0.05] },
    rain:     { amt: 0.9, cov: 0.86, shadow: 0.08, base: [0.42, 0.45, 0.5], top: [0.62, 0.65, 0.7], fade: [0.6, 0.05] },
    part:     { amt: 0.85, cov: 0.42, shadow: 0.28, base: [0.62, 0.66, 0.72], top: [0.99, 0.98, 0.96], fade: [0.5, 0.0] },
    storm:    { amt: 1, cov: 0.9, shadow: 0.05, base: [0.16, 0.18, 0.23], top: [0.28, 0.31, 0.39], fade: [0.6, 0.05] }
  };

  /* ---------------- lightning: strikes and flashes inside the cloud ---------------- */
  // a real flash flickers: two to four strokes within half a second, then it fades
  function planStrike(now) {
    var bolt = R() < 0.35, pulses = [], t = 0, n = 2 + Math.floor(R() * 3);
    for (var i = 0; i < n; i++) { pulses.push([t, 0.65 + R() * 0.35 * (i ? 0.8 : 1)]); t += 70 + R() * 130; }
    var x = 0.15 + R() * 0.7;
    S.strike = { t0: now, pulses: pulses, end: t + 420, bolt: bolt };
    S.strikeAt = [x, 0.08 + R() * 0.12];
    if (bolt) {
      S.boltN = Math.floor(R() * T.bolts.length);
      var bh = 0.55 + R() * 0.25, bw = bh * 360 / 640 * 0.5625;
      S.bolt = [x - bw / 2, S.strikeAt[1] - 0.04, bw, bh];
    }
    S.boltOn = bolt ? 1 : 0;
    S.nextStrike = now + 5000 + R() * 11000;
  }
  function strikeLevel(now) {
    var s = S.strike;
    if (!s) return 0;
    var dt = now - s.t0, v = 0;
    if (dt > s.end) { S.strike = null; return 0; }
    s.pulses.forEach(function (p) {
      var k = dt - p[0];
      if (k < 0) return;
      v = Math.max(v, k < 45 ? p[1] : p[1] * Math.exp(-(k - 45) / 110));
    });
    return v;
  }

  /* ---------------- the loop ---------------- */
  function frame(now) {
    S.raf = 0;
    if (!S.on || !S.hasImg) return;
    if (document.hidden) { S.raf = requestAnimationFrame(frame); return; }
    if (now - S.last < 30) { S.raf = requestAnimationFrame(frame); return; }   // about 30 frames a second
    S.last = now; S.frame++;
    if (S.mix < 1) S.mix = Math.min(1, (now - S.mixT) / 600);
    if (S.anim) {
      S.time = (now - S.t0) / 1000;
      if (S.lightning) { if (!S.strike && now > S.nextStrike) planStrike(now); S.flash = strikeLevel(now); }
      if (S.glass) {
        spawnHead(now);
        if (S.kind !== 'drizzle' || R() < 0.3) newDrops();
        stepHeads(1);
        if (S.frame % 10 === 0) fadeTrail();
      }
    }
    if (S.glass) composeWater();
    final();
    if (S.anim || S.mix < 1) S.raf = requestAnimationFrame(frame);
  }
  function newDrops() {   // rain keeps hitting the glass
    var n = S.kind === 'heavy' ? 3 : 1;
    if (R() > (S.kind === 'heavy' ? 0.9 : 0.5)) return;
    bindTarget('still'); use(P.sprite); blendNormal();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.drop); gl.uniform1i(u(P.sprite, 'uT'), 0); gl.uniform1f(u(P.sprite, 'uA'), 1);
    for (var i = 0; i < n; i++) drawDrop(R() * W, R() * H, 0.8 + Math.pow(R(), 2.5) * 3.2);
  }
  function kick() { if (!S.raf && S.on) S.raf = requestAnimationFrame(frame); }
  // a still picture: let a few drops run their whole way first, then draw once
  function settle() {
    if (S.anim || S.kind === 'drizzle' || !S.glass) return;
    var n = S.kind === 'heavy' ? 6 : 4;
    for (var i = 0; i < n; i++) S.heads.push(newHead(R() * H * 0.3, 1));
    var guard = 0;
    while (S.heads.length && guard++ < 900) stepHeads(1);
  }

  window.DOM_RAIN = {
    supported: function () {
      try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
    },
    mount: function (canvas) {
      if (gl) return true;
      try {
        cv = canvas; cv.width = W; cv.height = H;
        gl = cv.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false, premultipliedAlpha: false }) ||
             cv.getContext('experimental-webgl', { alpha: false, antialias: false, depth: false });
        if (!gl) { ERR = 'no WebGL context'; return false; }
        try { var dbg = gl.getExtension('WEBGL_debug_renderer_info'); INFO = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)); } catch (e2) {}
        buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        P.sprite = program(FS_SPRITE); P.copy = program(FS_COPY); P.fill = program(FS_FILL); P.final = program(FS_FINAL);
        T.drop = texture(0, 0, dropSprite()); T.soft = texture(0, 0, softSprite());
        T.noise = texture(0, 0, noiseCanvas());
        gl.bindTexture(gl.TEXTURE_2D, T.noise);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        T.bolts = [1, 2, 3, 4].map(function (k) { return texture(0, 0, boltCanvas(k * 7)); });
        S.t0 = performance.now();
        target('still'); target('trail'); target('water');
        T.sharpA = texture(W, H); T.blurA = texture(240, 135); T.sharpB = texture(W, H); T.blurB = texture(240, 135);
        seedDrops();
        return true;
      } catch (e) { ERR = 'setup: ' + (e && e.message || e); console.log('rain glass', e); gl = null; return false; }
    },
    set: function (o) {
      if (!gl) return;
      var kind = o.kind || 'rain', glass = o.glass !== false;
      var changed = kind !== S.kind || !!o.animated !== S.anim || !S.on || glass !== S.glass;
      S.kind = kind; S.anim = !!o.animated; S.on = true; S.glass = glass;
      S.grade = o.grade || [1, 1, 1];
      S.haze = kind === 'heavy' ? 0.2 : 0.13;
      S.sky = o.sky || ''; S.fog = o.fog || 0;
      S.lightning = !!o.lightning;
      if (!S.lightning) { S.strike = null; S.flash = 0; S.boltOn = 0; }
      else if (!S.anim) {   // a still picture: a strike caught in the photo
        planStrike(performance.now()); S.flash = 0.85; S.boltOn = 1; S.boltN = 1; S.bolt = [0.52, S.strikeAt[1] - 0.04, 0.26, 0.72]; S.strikeAt[0] = 0.65;
      } else S.nextStrike = performance.now() + 1500;
      if (!S.anim) S.time = 37;
      if (changed) { seedDrops(); settle(); }
      if (S.hasImg) { composeWater(); final(); }
      kick();
    },
    image: function (img, alignY) {
      if (!gl || !img) return false;
      try { if (!prepare(img, alignY)) { ERR = 'picture has no size'; return false; } } catch (e) { ERR = 'draw: ' + (e && e.message || e); return false; }
      try {
        // the old picture becomes A, the new one B, and the glass cross-fades like the background does
        var t = T.sharpA; T.sharpA = T.sharpB; T.sharpB = t; t = T.blurA; T.blurA = T.blurB; T.blurB = t;
        gl.bindTexture(gl.TEXTURE_2D, T.sharpB); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, SHARP);
        gl.bindTexture(gl.TEXTURE_2D, T.blurB); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, BLUR);
      } catch (e) { ERR = 'texture: ' + (e && (e.name + ' ' + e.message) || e); console.log('rain glass picture', e); return false; }   // a picture from elsewhere that the browser will not hand over
      S.mix = S.hasImg ? 0 : 1; S.mixT = performance.now(); S.hasImg = true;
      if (S.on) { composeWater(); final(); kick(); }
      return true;
    },
    flash: function () { if (S.lightning) { planStrike(performance.now()); kick(); } },
    stop: function () { S.on = false; if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; },
    active: function () { return S.on && S.hasImg; },
    error: function () { return ERR; },
    renderer: function () { return INFO; }
  };
})();
