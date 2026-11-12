// Dom smoke test: loads the launcher in a browser (demo mode: no TV services), goes through every
// layout and every Settings page, checks the landscape generator.
//   node tests/smoke.js            (needs the playwright package and its Chromium)
//   SHOTS=dir node tests/smoke.js  also saves screenshots
'use strict';
var path = require('path');
var fs = require('fs');
var chromium = require('playwright').chromium;
var APP = 'file://' + path.resolve(__dirname, '../app/index.html');
var SHOTS = process.env.SHOTS || '';
var failures = [];
function fail(msg) { failures.push(msg); console.log('  FAIL ' + msg); }

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  var errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  // no network in tests: everything from the internet fails fast
  await page.route(/^https?:/, function (r) { r.abort(); });
  async function key(code, n) { for (var i = 0; i < (n || 1); i++) { await page.keyboard.down(code); await page.keyboard.up(code); await page.waitForTimeout(60); } }
  async function shot(name) { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } }

  console.log('landscapes');
  await page.goto(APP);
  await page.waitForTimeout(800);
  var bad = await page.evaluate(function () {
    var out = [], moods = [undefined].concat(window.DOM_LANDSCAPE.moods), ws = [undefined].concat(window.DOM_LANDSCAPE.weathers);
    for (var i = 0; i < 90; i++) {
      var L = window.DOM_LANDSCAPE(1000 + i * 7919, i % 3, { mood: moods[i % moods.length], weather: ws[(i >> 1) % ws.length] });
      var svg = decodeURIComponent(L.url.replace(/^data:image\/svg\+xml,/, ''));
      var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (doc.getElementsByTagName('parsererror').length || /NaN|undefined/.test(svg)) out.push(L.title + ' #' + i);
    }
    return out;
  });
  if (bad.length) fail('broken landscapes: ' + bad.join(', '));

  var layouts = await page.evaluate(function () { return ['classic', 'sidebar', 'bento', 'carousel', 'ambient', 'traka', 'konzola', 'harmonika']; });
  for (var li = 0; li < layouts.length; li++) {
    var lay = layouts[li];
    console.log('layout ' + lay);
    await page.evaluate(function (l) { localStorage.clear(); localStorage.setItem('dom.layout', JSON.stringify(l)); }, lay);
    await page.reload();
    await page.waitForTimeout(900);
    var tiles = await page.evaluate(function () { return document.querySelectorAll('.tile').length; });
    if (tiles < 5) fail(lay + ': only ' + tiles + ' tiles');
    await key('ArrowRight', 2); await key('ArrowDown'); await key('ArrowUp', 2); await key('ArrowLeft');
    await shot('layout-' + lay);
  }

  console.log('settings');
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.waitForTimeout(800);
  async function title() { return page.evaluate(function () { return document.querySelector('#settings').classList.contains('hidden') ? '' : document.querySelector('#settings h1').textContent; }); }
  async function openTop() {
    if (await title() !== 'Postavke') {
      if (await title()) { await key('Escape'); await key('Escape'); }
      await page.evaluate(function () { document.querySelector('.tile-settings').click(); });
      await page.waitForTimeout(300);
    }
  }
  async function rowLabels() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#settings-body .s-row'), function (r) { return r.textContent.trim(); });
    });
  }
  async function clickRow(prefix) {
    return page.evaluate(function (p) {
      var rows = document.querySelectorAll('#settings-body .s-row');
      for (var i = 0; i < rows.length; i++) if (rows[i].textContent.trim().indexOf(p) === 0) { rows[i].click(); return true; }
      return false;
    }, prefix);
  }
  await openTop();
  if (await title() !== 'Postavke') fail('settings did not open');
  await shot('settings');
  // a page is a row ending in "›" whose label is the page title
  var top = (await rowLabels()).filter(function (t) { return /›$/.test(t); }).map(function (t) { return t.split(/\s{2,}|(?=[A-ZČŠŽ0-9][a-zčšž]*\s*›$)/)[0]; });
  var pages = ['Tema', 'Pozadine', 'Aplikacije', 'Računi i prognoza', 'Pametni dom', 'Dječji profil', 'Statistika gledanja', 'Čišćenje i ubrzanje', 'Sustav'];
  pages.forEach(function (p) { if (!top.some(function (t) { return t.indexOf(p) === 0; })) fail('no settings page ' + p + ' in ' + top.join(' / ')); });
  for (var gi = 0; gi < pages.length; gi++) {
    await openTop();
    if (!await clickRow(pages[gi])) { fail('cannot open ' + pages[gi]); continue; }
    await page.waitForTimeout(300);
    var t1 = await title();
    var n = await page.evaluate(function () { return document.querySelectorAll('#settings-body .s-row, #settings-body .s-note').length; });
    console.log('  ' + t1 + ': ' + n + ' rows');
    if (t1 !== pages[gi]) fail('opened ' + t1 + ' instead of ' + pages[gi]);
    if (!n) fail('empty settings page ' + t1);
    await shot('settings-' + t1.replace(/\W+/g, '_'));
    if (t1 === 'Sustav') {
      var subs = ['Stanje sustava', 'Napredno'];
      for (var si = 0; si < subs.length; si++) {
        if (!await clickRow(subs[si])) { fail('cannot open ' + subs[si]); continue; }
        await page.waitForTimeout(300);
        var st = await title();
        if (st !== subs[si]) fail('opened ' + st + ' instead of ' + subs[si]);
        console.log('    ' + st);
        await shot('settings-' + st.replace(/\W+/g, '_'));
        await key('Escape');
        if (await title() !== 'Sustav') fail('Back from ' + st + ' went to ' + await title());
      }
    }
    await key('Escape');
    if (await title() !== 'Postavke') fail('Back from ' + t1 + ' went to ' + await title());
  }
  // every quick action can be pressed
  var quick = ['Način slike', 'Zvuk', 'Tajmer za spavanje'];
  for (var qi = 0; qi < quick.length; qi++) { await openTop(); if (!await clickRow(quick[qi])) fail('no quick action ' + quick[qi]); await page.waitForTimeout(150); }
  await openTop();
  await clickRow('Tema'); await page.waitForTimeout(200);
  for (var ti = 0; ti < 3; ti++) { await clickRow('Noćni način'); await clickRow('Redoslijed aplikacija'); await page.waitForTimeout(80); }
  await clickRow('Zaštita OLED ekrana'); await clickRow('Zaštita OLED ekrana');
  await key('Escape'); await key('Escape');

  console.log('quick menu, kids, night, saver');
  await page.evaluate(function () {
    localStorage.setItem('dom.pin', JSON.stringify('1234'));
    localStorage.setItem('dom.kids', JSON.stringify({ on: true, apps: ['demo2', 'demo10'], limit: 30, used: { d: new Date().toDateString(), s: 0 }, leftAt: 0 }));
    localStorage.setItem('dom.night', JSON.stringify('late'));
  });
  await page.reload();
  await page.waitForTimeout(800);
  var kidTiles = await page.evaluate(function () { return document.querySelectorAll('.tile').length; });
  if (kidTiles !== 3) fail('kids mode shows ' + kidTiles + ' tiles, expected 2 apps + Settings');
  await page.keyboard.down('F2'); // nothing
  await page.evaluate(function () { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403 })); });
  await page.waitForTimeout(300);
  await shot('quick-menu');
  var quick = await page.evaluate(function () { return document.querySelector('#settings h1').textContent; });
  if (quick !== 'Brzi izbornik') fail('red button opened ' + quick);

  await page.evaluate(function () {
    document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { dom: 'console', appId: 'com.webos.app.hdmi2', label: 'PS5 Game Console' } }));
  });
  await page.waitForTimeout(300);
  var t = await page.evaluate(function () { return document.getElementById('toast').textContent; });
  if (!/PlayStation/.test(t)) fail('console offer: ' + t);
  await shot('console-offer');

  if (errors.length) fail('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(failures.length ? failures.length + ' failure(s)' : 'all good');
  process.exit(failures.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
