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
