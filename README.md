# CloudCut — studio montażu wideo

Program do montażu wideo z kontami, projektami na komputerze, zapisem wybranych projektów na GitHubie
i aktualizacjami z repozytorium.

## Co gdzie jest

| Folder / plik | Zawartość |
|---|---|
| `index.html`, `style.css` | wygląd programu: edytor, menu główne, okna |
| `js/` | logika: montaż, eksport, menu główne (`home.js`), GitHub (`github.js`), aktualizacje (`updates.js`) |
| `server/` | serwer PHP: konta, projekty i pliki (`api.php`, `lib.php`), wysyłka na GitHub (`github.php`, `github-push.php`), aktualizacje (`update.php`) |
| `router.php` | wejście dla wbudowanego serwera PHP |
| `vendor/` | biblioteki do eksportu wideo (mediabunny) |
| `desktop/` | wersja na komputer — CloudCut.exe (Electron): `main.js`, `preload.js`, skrypty budowania w `scripts/`, ikona w `build/` |

## Uruchomienie w przeglądarce (do pracy nad kodem)

Potrzebne PHP 8.3 z modułami curl, openssl, pdo_sqlite i mbstring:

```
php -d post_max_size=0 -d upload_max_filesize=0 -d memory_limit=512M -S 127.0.0.1:8780 router.php
```

Potem otwórz http://127.0.0.1:8780. Dane trafią do folderu `data/`.

## Zbudowanie CloudCut.exe

Potrzebny Node.js 24 i PHP 8.3 w `C:\php83` (inną ścieżkę podaj w zmiennej `CLOUDCUT_PHP`):

```
cd desktop
npm install
node node_modules/electron/install.js
npm run build
```

Gotowy program: `desktop/dist/CloudCut-win32-x64/CloudCut.exe`. Cały folder `CloudCut-win32-x64` skopiuj
np. do `%LOCALAPPDATA%\Programs\CloudCut`. Dane programu na komputerze są w `%APPDATA%\CloudCut\data`.

## Aktualizacje z GitHuba

Wrzuć ten folder do repozytorium na GitHubie (plik `.gitignore` pomija dane i pliki z budowania),
a w CloudCut wpisz link do repozytorium w Ustawienia → Aktualizacje programu. Gdy zmienisz tu któryś plik
programu i wyślesz go na GitHuba, CloudCut zaproponuje aktualizację. Podmieniane są tylko pliki z folderów
powyżej (bez `server/config.php` i bez danych); przed instalacją program robi kopię poprzedniej wersji.
Zmiany w `desktop/` (okno Electrona) wymagają ponownego zbudowania CloudCut.exe.
