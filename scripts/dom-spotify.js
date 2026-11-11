// Dom: connect the "Što svira" line to your Spotify account (one-time, over SSH).
//
//   node /home/root/dom-spotify.js <client id>
//
// Before that, at https://developer.spotify.com/dashboard create an app with
//   Redirect URI:  http://127.0.0.1:8888/callback      API: Web API
// and copy its Client ID. No client secret is used (Authorization Code with PKCE).
//
// The result is /home/root/dom-spotify.json, which only Dom on this TV reads.
// Plain Node, no modules; requests go through curl.
'use strict';
var crypto = require('crypto');
var fs = require('fs');
var readline = require('readline');
var cp = require('child_process');

var FILE = '/home/root/dom-spotify.json';
var REDIRECT = 'http://127.0.0.1:8888/callback';
var SCOPE = 'user-read-currently-playing user-read-playback-state';

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function die(msg) { console.log('\n!! ' + msg); process.exit(1); }
function curl(args) {
  try { return cp.execFileSync('curl', ['-s', '-m', '25'].concat(args), { encoding: 'utf8' }); }
  catch (e) { return ''; }
}

var cid = (process.argv[2] || '').trim();
if (!/^[0-9a-f]{32}$/i.test(cid)) {
  die('Pokreni ovako:  node /home/root/dom-spotify.js <Client ID>\n   Client ID je 32 znaka s developer.spotify.com/dashboard (ne Client secret).');
}

var verifier = b64url(crypto.randomBytes(48));
var challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
var state = b64url(crypto.randomBytes(9));
var url = 'https://accounts.spotify.com/authorize?response_type=code&client_id=' + cid +
  '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&scope=' + encodeURIComponent(SCOPE) +
  '&code_challenge_method=S256&code_challenge=' + challenge + '&state=' + state;

console.log('\n1) Otvori ovu adresu u pregledniku (na mobitelu ili računalu) i dopusti pristup:\n');
console.log(url + '\n');
console.log('2) Preglednik će zatim otvoriti stranicu koja se NE učitava (127.0.0.1) - to je u redu.');
console.log('   Kopiraj cijelu adresu iz adresne trake, zalijepi je ovdje i stisni Enter:\n');

var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('> ', function (answer) {
  rl.close();
  answer = String(answer || '').trim();
  var m = /[?&]code=([^&\s]+)/.exec(answer);
  var code = m ? decodeURIComponent(m[1]) : (/^[\w-]{40,}$/.test(answer) ? answer : '');
  if (/[?&]error=/.test(answer)) die('Spotify je odbio prijavu: ' + answer.replace(/.*[?&]error=([^&]*).*/, '$1'));
  if (!code) die('U zalijepljenoj adresi nema dijela "code=". Pokreni ponovno i zalijepi cijelu adresu.');
  var st = /[?&]state=([^&\s]+)/.exec(answer);
  if (st && st[1] !== state) die('Adresa nije od ove prijave (pogrešan "state"). Pokreni ponovno.');

  var out = curl(['-X', 'POST', 'https://accounts.spotify.com/api/token',
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '--data-urlencode', 'grant_type=authorization_code',
    '--data-urlencode', 'code=' + code,
    '--data-urlencode', 'redirect_uri=' + REDIRECT,
    '--data-urlencode', 'client_id=' + cid,
    '--data-urlencode', 'code_verifier=' + verifier]);
  var tok;
  try { tok = JSON.parse(out); } catch (e) { die('Spotify nije odgovorio (mreža ili DNS?). Odgovor: ' + (out || '(prazno)').slice(0, 200)); }
  if (!tok.refresh_token) die('Prijava nije uspjela: ' + (tok.error_description || tok.error || out).toString().slice(0, 200));

  var now = Date.now();
  fs.writeFileSync(FILE, JSON.stringify({
    client_id: cid, refresh_token: tok.refresh_token, access_token: tok.access_token || '',
    expires_at: now + ((tok.expires_in || 3600) - 60) * 1000, at: now
  }));
  try { fs.chmodSync(FILE, 384); } catch (e) {}   // 0600

  var chk = curl(['-o', '/dev/null', '-w', '%{http_code}', '-H', 'Authorization: Bearer ' + tok.access_token,
    'https://api.spotify.com/v1/me/player/currently-playing']);
  if (chk === '200') console.log('\nPovezano. Spotify upravo svira - otvori Dom (tipka Home) i pogledaj ispod sata.');
  else if (chk === '204') console.log('\nPovezano. Trenutno ništa ne svira; pusti pjesmu i otvori Dom.');
  else console.log('\nPrijava je spremljena, ali provjera je vratila ' + (chk || 'ništa') + '. Ako se u Domu ništa ne pojavi, javi taj broj.');
});
