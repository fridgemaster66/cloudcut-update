// Składa desktop/runtime: wbudowany PHP (tylko potrzebne moduły) i pliki programu z montaz-wideo/.
// Uruchamiany przed „npm start” i „npm run build”.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(DESKTOP, '..');
const RUNTIME = path.join(DESKTOP, 'runtime');
const PHP_SRC = process.env.CLOUDCUT_PHP || 'C:\\php83';

const PHP_FILES = [
  'php.exe', 'php-win.exe', 'php8ts.dll', 'cacert.pem', 'license.txt',
  // zależności modułów curl, openssl i pdo_sqlite
  'libcrypto-3-x64.dll', 'libssl-3-x64.dll', 'libssh2.dll', 'nghttp2.dll', 'brotlicommon.dll', 'brotlidec.dll', 'libsqlite3.dll',
];
const PHP_EXT = ['php_curl.dll', 'php_mbstring.dll', 'php_openssl.dll', 'php_pdo_sqlite.dll', 'php_fileinfo.dll'];
// biblioteki Visual C++, których potrzebuje PHP — żeby program działał też na komputerze bez nich
const VC_RUNTIME = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];
const WEB = ['index.html', 'style.css', 'router.php', 'js', 'vendor', 'server'];

fs.rmSync(RUNTIME, { recursive: true, force: true });
const php = path.join(RUNTIME, 'php');
fs.mkdirSync(path.join(php, 'ext'), { recursive: true });
for (const f of PHP_FILES) fs.copyFileSync(path.join(PHP_SRC, f), path.join(php, f));
for (const f of PHP_EXT) fs.copyFileSync(path.join(PHP_SRC, 'ext', f), path.join(php, 'ext', f));
for (const f of VC_RUNTIME) {
  const src = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(php, f));
}
const web = path.join(RUNTIME, 'web');
for (const f of WEB) fs.cpSync(path.join(APP, f), path.join(web, f), { recursive: true });
// znacznik wersji na komputer: tylko tu aktualizacja może podmieniać pliki programu (server/update.php)
fs.writeFileSync(path.join(web, '.cloudcut-desktop'), '');

const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`runtime gotowy: PHP ${(size(php) / 1048576).toFixed(1)} MB, program ${(size(web) / 1048576).toFixed(1)} MB`);
