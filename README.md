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
curl -fsSL https://raw.githubusercontent.com/deganegane/dom-launcher/main/scripts/install.sh | sh
```

Skripta skida zadnji `.ipk` iz GitHub Releases, instalira ga i dodaje autostart
(`/var/lib/webosbrew/init.d/90-dom-launcher`) da se launcher pali nakon paljenja TV-a.

## Home tipka

Instalacija pokreće mali servis (`/home/root/dom-homeguard.sh`) koji prati aplikaciju u prvom planu:
kad god se pojavi LG Home (Home tipka, paljenje TV-a, izlaz iz aplikacije), odmah otvara Dom.
LG Home može nakratko bljesnuti. Log: `cat /tmp/dom-homeguard.log`. Originalni LG Home i dalje se otvara iz Postavki u launcheru.

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

## Razvoj

Otvori `app/index.html` u pregledniku — bez webOS-a radi u demo modu s lažnim podacima
(strelice, Enter, Escape).

Svaki push na `main` gradi `.ipk` (GitHub Actions) i objavljuje ga kao novi release.

## Uklanjanje

```sh
curl -fsSL https://raw.githubusercontent.com/deganegane/dom-launcher/main/scripts/uninstall.sh | sh
```
