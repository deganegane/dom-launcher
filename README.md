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

1. U Homebrew Channelu instaliraj **LG Input Hook** i jednom ga pokreni.
2. *Add keybind* → ID Home tipke (vidi log u aplikaciji kad pritisneš Home) → akcija: pokreni aplikaciju `com.deganegane.dom`.
3. U LG postavkama isključi *Home automatsko pokretanje* (Općenito → Postavke početnog zaslona).

Originalni LG Home i dalje postoji — otvara se iz Postavki u launcheru.

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
