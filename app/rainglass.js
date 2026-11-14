// Dom: rain on the window, drawn with WebGL. window.DOM_RAIN
//
// The picture behind the glass is blurred and misted; drops act as small lenses (a sharp, shifted bit
// of the picture inside each, a soft rim, a small highlight); now and then a drop gets heavy and runs
// down, picking up the drops in its way, leaving beads behind and a clearer trail that mists over again.
//
// Everything that moves lives in three textures on the graphics chip (the drops that sit still, the
// trail, the water of this frame); the main thread only moves a few running drops around.
//   DOM_RAIN.supported()                     WebGL is there
//   DOM_RAIN.mount(canvas)                   draw into this canvas
//   DOM_RAIN.set({ kind, animated, grade })  kind: drizzle | rain | heavy
//   DOM_RAIN.image(img, alignY)              the picture behind the glass (0 = top, 0.5 = centre); false if it could not be used
//   DOM_RAIN.flash()                         a lightning flash, seen through the glass
//   DOM_RAIN.stop()
(function () {
  'use strict';
  var W = 960, H = 540;          // drawn at half the screen size: the scene is blurred anyway, drops stay crisp enough
  var gl = null, cv = null, P = {}, buf = null, T = {}, F = {};
  var ERR = '', INFO = '';
  var S = { on: false, anim: false, kind: 'rain', grade: [1, 1, 1], haze: 0.12, mix: 1, mixT: 0, hasImg: false,
            heads: [], spawnAt: 0, raf: 0, last: 0, frame: 0, flash: 0 };

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
    'uniform sampler2D uSharpA, uBlurA, uSharpB, uBlurB, uWater, uTrail;',
    'uniform float uMix, uHaze, uFlash;',
    'uniform vec3 uGrade;',
    'uniform vec2 uPx;',
    'vec3 sharp(vec2 uv){ return mix(texture2D(uSharpA, uv).rgb, texture2D(uSharpB, uv).rgb, uMix); }',
    'vec3 blr(vec2 uv){ return mix(texture2D(uBlurA, uv).rgb, texture2D(uBlurB, uv).rgb, uMix); }',
    'vec3 blurred(vec2 uv){ vec2 o = uPx * 0.8; return (blr(uv + vec2(o.x, o.y)) + blr(uv + vec2(-o.x, o.y)) + blr(uv + vec2(o.x, -o.y)) + blr(uv - o)) * 0.25; }',
    'void main(){',
    '  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);',
    '  vec4 w = texture2D(uWater, fuv);',
    '  float tr = texture2D(uTrail, fuv).a;',
    '  vec3 mist = vec3(0.80, 0.83, 0.87);',
    // misted glass, clearer (and a touch darker) where a running drop wiped it
    '  vec3 back = mix(blurred(vUv) * (1.0 - uHaze) + mist * uHaze, sharp(vUv) * 0.93, clamp(tr * 1.1, 0.0, 0.9));',
    '  vec2 n = (w.rg - 0.5) * 2.0;',
    '  float a = smoothstep(0.08, 0.55, w.a);',
    // a drop is a lens: the scene inside it sharp, pushed out by its slope, lifted by its thickness
    '  vec2 ruv = clamp(vUv + n * 0.028 - vec2(0.0, w.b * 0.01), 0.0, 1.0);',
    '  vec3 lens = sharp(ruv) * 0.8 + blurred(ruv) * 0.2;',
    '  float nz = sqrt(clamp(1.0 - dot(n, n), 0.0, 1.0));',
    '  float rim = pow(1.0 - nz, 2.0);',
    '  float spec = pow(max(dot(vec3(n, nz), normalize(vec3(-0.45, -0.6, 0.66))), 0.0), 90.0) * 0.5;',
    // water on glass carries a little of the mist's light too, so a drop never looks like a dark hole
    '  lens = lens * 1.05 * (1.0 - uHaze * 0.5) + mist * uHaze * 0.5;',
    '  vec3 drop = lens * (1.0 - rim * 0.25) + spec + lens * pow(clamp(n.y, 0.0, 1.0), 2.0) * 0.12;',
    '  vec3 c = mix(back, drop, a);',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(vec3(l), c, uGrade.x);',
    '  c = (c - 0.5) * uGrade.z + 0.5;',
    '  c *= uGrade.y;',
    '  c += uFlash * vec3(0.55, 0.6, 0.75) * (0.35 + 0.65 * (1.0 - vUv.y));',
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
    S.heads.push({ x: 20 + R() * (W - 40), y: R() * H * 0.45, r: 4.5 + R() * 3, vy: 0.4, stick: 0, drift: (R() - 0.5) * 0.25 });
  }
  // a running drop: it speeds up and slows down, sometimes sticks, wanders a little, grows as it picks drops up
  function stepHeads(steps) {
    var still = [], trail = [], beads = [];
    for (var s = 0; s < steps; s++) {
      for (var i = S.heads.length - 1; i >= 0; i--) {
        var h = S.heads[i];
        if (h.stick > 0) { h.stick--; continue; }
        h.vy = Math.max(0.25, Math.min(3.6, h.vy + (R() - 0.42) * 0.5)) ;
        var dy = h.vy * (0.55 + h.r / 9);
        h.y += dy; h.x += h.drift + (R() - 0.5) * 0.9;
        h.r = Math.min(10, h.r + 0.015);
        if (R() < 0.008) h.stick = 6 + Math.floor(R() * 30);
        still.push([h.x, h.y, h.r * 1.2]);
        // the water it leaves behind: a thin beaded channel just above it
        if (R() < 0.7) beads.push([h.x + (R() - 0.5) * h.r * 0.35, h.y - h.r * (1.65 + R() * 0.3), h.r * (0.3 + R() * 0.18)]);
        trail.push([h.x, h.y - dy / 2, h.r * 1.5, dy]);
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
    [['uSharpA', T.sharpA], ['uBlurA', T.blurA], ['uSharpB', T.sharpB], ['uBlurB', T.blurB], ['uWater', T.water], ['uTrail', T.trail]].forEach(function (x, i) {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, x[1]); gl.uniform1i(u(p, x[0]), i);
    });
    gl.uniform1f(u(p, 'uMix'), S.mix); gl.uniform1f(u(p, 'uHaze'), S.haze); gl.uniform1f(u(p, 'uFlash'), S.flash);
    gl.uniform3f(u(p, 'uGrade'), S.grade[0], S.grade[1], S.grade[2]);
    gl.uniform2f(u(p, 'uPx'), 1 / 240, 1 / 135);
    quad(p, 0, 0, W, H);
  }

  /* ---------------- the loop ---------------- */
  function frame(now) {
    S.raf = 0;
    if (!S.on || !S.hasImg) return;
    if (document.hidden) { S.raf = requestAnimationFrame(frame); return; }
    if (now - S.last < 30) { S.raf = requestAnimationFrame(frame); return; }   // about 30 frames a second
    S.last = now; S.frame++;
    if (S.mix < 1) S.mix = Math.min(1, (now - S.mixT) / 600);
    if (S.flash > 0) S.flash = Math.max(0, S.flash - 0.06);
    if (S.anim) {
      spawnHead(now);
      if (S.kind !== 'drizzle' || R() < 0.3) newDrops();
      stepHeads(1);
      if (S.frame % 10 === 0) fadeTrail();
    }
    composeWater();
    final();
    if (S.anim || S.mix < 1 || S.flash > 0) S.raf = requestAnimationFrame(frame);
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
    if (S.anim || S.kind === 'drizzle') return;
    var n = S.kind === 'heavy' ? 6 : 4;
    for (var i = 0; i < n; i++) S.heads.push({ x: 20 + R() * (W - 40), y: R() * H * 0.3, r: 4.5 + R() * 3, vy: 1, stick: 0, drift: (R() - 0.5) * 0.25 });
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
        target('still'); target('trail'); target('water');
        T.sharpA = texture(W, H); T.blurA = texture(240, 135); T.sharpB = texture(W, H); T.blurB = texture(240, 135);
        seedDrops();
        return true;
      } catch (e) { ERR = 'setup: ' + (e && e.message || e); console.log('rain glass', e); gl = null; return false; }
    },
    set: function (o) {
      if (!gl) return;
      var kind = o.kind || 'rain', changed = kind !== S.kind || !!o.animated !== S.anim || !S.on;
      S.kind = kind; S.anim = !!o.animated; S.on = true;
      S.grade = o.grade || [1, 1, 1];
      S.haze = kind === 'heavy' ? 0.2 : 0.13;
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
    flash: function () { S.flash = 1; kick(); },
    stop: function () { S.on = false; if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; },
    active: function () { return S.on && S.hasImg; },
    error: function () { return ERR; },
    renderer: function () { return INFO; }
  };
})();
