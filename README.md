# Dom — Apple TV launcher za LG webOS

Zamjenski home screen u stilu Apple TV-a za rootane LG TV-e (testirano za LG C5, webOS 11).

- Veliki "Top Shelf" s pozadinom aplikacije u fokusu
- Mreža ikona s povećanjem, sjajem i paralaksom (radi i s Magic Remote pokazivačem)
- **Stremio "Nastavi gledati"**: red kartica s napretkom, pozadine i logotipi serija
- Dugi pritisak na OK → premještanje aplikacija
- Postavke: Stremio prijava, skrivanje aplikacija, otvaranje originalnog LG Home-a

## Instalacija

Preduvjeti: rootan TV, Homebrew Channel, uključen SSH (Homebrew Channel → Settings → SSH).

Na TV-u, preko SSH-a kao root:

```sh
curl -fsSL "https://raw.githubusercontent.com/deganegane/dom-launcher/main/scripts/install.sh?$(date +%s)" | sh
```

Skripta skida zadnji `.ipk` iz GitHub Releases, instalira ga i dodaje autostart
(`/var/lib/webosbrew/init.d/90-dom-launcher`) da se launcher pali nakon paljenja TV-a.

## Home tipka

Instalacija pokreće mali servis (`/home/root/dom-homeguard.sh`) koji prati aplikaciju u prvom planu:
kad god se pojavi LG Home (Home tipka, paljenje TV-a, izlaz iz aplikacije), odmah otvara Dom.
Log: `cat /tmp/dom-homeguard.log`.

Da se pri povratku iz aplikacije ne vidi LG-ovo sučelje, `/home/root/dom-blank-home.sh on` prekrije
raspored LG Homea praznim (bind mount, pokreće ga `init.d/06-dom-blank-home`), a Dom se pojavi uz
kratko pretapanje iz crnog. "Otvori originalni LG Home" u Postavkama privremeno vraća LG Home;
trajno: obriši `06-dom-blank-home` i ponovno pokreni TV. Originalni LG Home i dalje se otvara iz Postavki u launcheru.

LG Input Hook nije potreban (na webOS-u 11 ne zaustavlja Home tipku).

## Izgled

Postavke → "Izgled početnog zaslona" mijenja između:
- **Klasično**: mreža aplikacija, gore "Nastavi gledati".
- **Bočni izbornik**: aplikacije u popisu lijevo; strelica desno ulazi u mrežu kartica.
- **Bento**: velika pločica za ono što gledaš, dvije sporedne, aplikacije u redu ispod (strelica gore).
- **Karusel**: fokusirana aplikacija velika u sredini, susjedne okrenute u 3D; strelica dolje za kartice.
- **Ambijent**: slika preko cijelog ekrana, veliki sat i okrugle ikone; strelica gore za kartice.

Izbor se pamti.

## Isključivanje Doma

Postavke → "Dom kao početni zaslon" (ili `/home/root/dom-ctl.sh off` / `on`): Home tipka se vraća
na LG Home, a Dom ostaje instaliran kao obična aplikacija iz koje ga možeš ponovno uključiti.

## Pozadine

Dok gledaš neku aplikaciju, servis svakih ~20 s spremi kadar ekrana (`/home/root/dom-shots/`),
a launcher ga koristi kao pozadinu te aplikacije — "ono što si zadnje gledao". DRM sadržaj
(Netflix i sl.) snima se kao crno pa se preskače.

Aplikacije koje imaju svoju pozadinu (npr. Netflix) inače koriste nju. Ostale dobiju ambijentalnu
pozadinu u boji svoje ikone (PS5, Xbox i Switch u boji svog brenda).

Vlastita slika: stavi je u `/home/root/dom-backgrounds/` nazvanu po ID-u ili nazivu aplikacije,
npr. `PS5 Game Console.jpg` ili `youtube.leanback.v4.png` (jpg, png ili webp, idealno 1920×1080).
Učitava se kad se launcher ponovno otvori.

## Stremio

Postavke (zupčanik na kraju mreže) → upiši Stremio email i lozinku. Launcher sprema samo
`authKey`, a "Nastavi gledati" čita s `api.strem.io` (isti API koji koriste službene aplikacije).
Ako zahtjev iz aplikacije ne prođe, launcher ga ponovi preko Homebrew Channel root servisa (`curl`).

Vlastita ikona: stavi sliku u `/home/root/dom-icons/` nazvanu po ID-u ili nazivu aplikacije
(npr. `PS5 Game Console.png`). Konzole na HDMI-ju (PS5, Xbox, Switch) inače dobiju pločicu u
boji brenda s crtežom kontrolera i pozadinu u istoj boji, bez snimke ekrana.

## Stremio epizoda s kartice

Stremio na webOS-u ne prima deep linkove, pa ih Dom zaobilazi: zatvori Stremio, ponovno ga
otvori i preko TV-ovog SSAP sučelja "pritisne" tipke do odabrane kartice (`/home/root/dom-keys.js`).
Pri instalaciji TV jednom traži dozvolu — prihvati je.

Redoslijed tipki je u `/home/root/dom-stremio-keys.txt` (ako ne postoji: `10000 {RIGHT} ENTER 1200 ENTER`; prvi broj je najdulje čekanje — skripta prati ekran i krene čim se Stremio učita; ostali brojevi su pauze u ms):
prvi broj je čekanje u ms, `{RIGHT}` se ponavlja onoliko puta koliko je kartica udaljena od prve.
Log: `cat /tmp/dom-keys.log`.

## Razvoj

Otvori `app/index.html` u pregledniku — bez webOS-a radi u demo modu s lažnim podacima
(strelice, Enter, Escape).

Svaki push na `main` gradi `.ipk` (GitHub Actions) i objavljuje ga kao novi release.

## Blokada firmware ažuriranja

Instalacija dodaje `/var/lib/webosbrew/init.d/05-dom-block-update`, koji pri svakom paljenju:
prekrije `/usr/sbin/update` praznom datotekom, preusmjeri LG update servere (snu/su/su-ssl/
snu-dev/su-dev/nsu.lge.com) na localhost i blokira IP 156.147.69.32 (ako postoji iptables).
Sve su to bind mountovi / pravila u radu — sustav se ne mijenja trajno. Ostaje i nakon uklanjanja
Doma; za poništavanje obriši tu datoteku i ponovno pokreni TV.
Uz to: uključi "Block system updates" u Homebrew Channelu i isključi automatska ažuriranja u postavkama.

## Uklanjanje

```sh
curl -fsSL https://raw.githubusercontent.com/deganegane/dom-launcher/main/scripts/uninstall.sh | sh
```

## Čišćenje i ubrzanje (dom-tune)

`scripts/dom-tune.sh` gasi LG-ove servise za praćenje i reklame, blokira njihove domene u hosts datoteci i smanjuje sistemsko logiranje. Sve je privremeno (runtime): prekidači su u Postavkama Doma, a restart TV-a bez hooka `07-dom-tune` vraća izvorno stanje.

```sh
/home/root/dom-tune.sh status        # izvještaj
/home/root/dom-tune.sh set voice 1   # grupe: track logs voice iot cast tv
/home/root/dom-tune.sh off           # vrati sve odmah
```

Ako se TV dvaput zaredom restarta unutar 10 minuta od primjene, čišćenje se samo pauzira (sigurnosni način).

## Pozadine s interneta

Postavke → Pozadina → "Pozadine s interneta". Kad je uključeno, u pozadini se izmjenjuju fotografije (Bing fotografija dana, ilustracije krajolika s wallhaven.cc, crtani krajolici koje Dom sam generira (landscapes.js) ili satelitske snimke Google Earth View) umjesto snimki iz aplikacija. Interval se bira (1 min – 1 h), "Zadrži trenutnu pozadinu" pauzira izmjenu, a "Sljedeća pozadina" preskače. Na daljinskima s medijskim ili obojenim tipkama: Play/Pause ili žuta zadržava, Fast-forward ili plava preskače.

## Izgledi

Klasično, Bočni izbornik, Bento, Karusel, Ambijent, Traka, Konzola, Harmonika. Mijenjaju se u Postavke → Izgled početnog zaslona.

## Vremenska prognoza

Postavke → Vremenska prognoza → upiši grad. Ispod sata se prikazuje trenutna temperatura, stanje i dnevni raspon. Podaci: Open-Meteo (bez ključa, besplatno za osobnu upotrebu), osvježava se svakih pola sata dok je Dom na ekranu.

## Čuvar zaslona, brze radnje, PIN

- **Čuvar zaslona** (Postavke → Izgled): nakon 2, 5 ili 10 minuta mirovanja ostaju samo pozadina, sat i prognoza; sat se svake minute pomakne, a nakon 20 minuta slika se dodatno zatamni. Dok je uključen, LG-ev čuvar zaslona se preko Doma ne pali.
- **Brze radnje** (vrh Postavki): gašenje ekrana uz zvuk i tajmer za spavanje (15/30/60/90 min).
- **Otvorene aplikacije** (dugo držanje tipke Natrag, crvena tipka na daljinskom, dugi OK na pločici Postavke ili Postavke → Brze radnje): popis aplikacija koje rade u pozadini; OK zatvara jednu, "Zatvori sve" sve odjednom.
- **Najčešće korištene aplikacije naprijed**: redoslijed se slaže sam prema broju pokretanja.
- **PIN za Postavke**: četiri znamenke; bez njega se Postavke (i skrivene aplikacije) ne otvaraju. Zaboravljen PIN: preko SSH-a `/home/root/dom-ctl.sh pinreset`.

## Nadogradnja i sigurnosna kopija

- **Nadogradi Dom** (Postavke → Sustav) skida i instalira najnoviju verziju bez SSH-a.
- **Spremi sigurnosnu kopiju** sprema postavke, ikone, pozadine i uparivanje u `/home/root/dom-backup`; **Vrati** ih učitava natrag.
- **Ugasi Telnet** (Čišćenje i ubrzanje): radi samo ako je SSH uključen i pokrenut.
