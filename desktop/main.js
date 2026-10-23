'use strict';
/*
 * CloudCut — program na komputer.
 * Uruchamia wbudowany PHP z serwerem programu (konta, projekty, pliki — wszystko w %APPDATA%\CloudCut\data)
 * i otwiera go w oknie aplikacji. Okno łączy się tylko z 127.0.0.1; linki zewnętrzne otwiera zwykła przeglądarka.
 */
const { app, BrowserWindow, Menu, shell, dialog, safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

// stały port = stałe miejsce na ustawienia okna i pamięć podręczną plików (są przypisane do adresu)
const PORTS = [47821, 47822, 47823, 47824, 47825];
let server = null, win = null, origin = '', quitting = false, closeConfirmed = false;
// testy uruchamiają program na osobnym katalogu danych, żeby nie dotykać prawdziwych projektów
if (process.env.CLOUDCUT_USER_DATA) app.setPath('userData', process.env.CLOUDCUT_USER_DATA);

const runtimeDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'runtime'));
const userDir = (...p) => path.join(app.getPath('userData'), ...p);

/* Klucz szyfrujący token GitHuba. Na dysku leży zaszyfrowany przez Windows (DPAPI), więc nie da się go użyć na innym koncie ani komputerze. */
function secretKey() {
  const f = userDir('secret.bin');
  const enc = safeStorage.isEncryptionAvailable();
  try {
    if (fs.existsSync(f)) {
      const raw = fs.readFileSync(f);
      const key = enc ? safeStorage.decryptString(raw) : raw.toString();
      if (/^[a-f0-9]{64}$/.test(key)) return key;
    }
  } catch { /* uszkodzony plik — nowy klucz (zapisany token trzeba będzie wkleić ponownie) */ }
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, enc ? safeStorage.encryptString(key) : key);
  return key;
}

/* php.ini tworzony przy każdym starcie. Moduły PHP wczytuje ścieżką względną („ext”, PHP startuje w swoim folderze),
   bo bezwzględnej ścieżki z polskim znakiem (C:\Users\Mivhał\…) Windows ich nie wczyta. */
function writePhpIni(php) {
  const q = p => `"${p.replace(/\\/g, '/')}"`;
  const lines = [
    '; CloudCut — ustawienia wbudowanego PHP (plik tworzony przy każdym starcie programu)',
    'extension_dir = "ext"',
    'extension=curl', 'extension=mbstring', 'extension=openssl', 'extension=pdo_sqlite', 'extension=fileinfo',
    `curl.cainfo = ${q(path.join(php, 'cacert.pem'))}`,
    `openssl.cafile = ${q(path.join(php, 'cacert.pem'))}`,
    'display_errors = Off', 'log_errors = On', `error_log = ${q(userDir('logs', 'php-bledy.log'))}`,
    'post_max_size = 0', 'upload_max_filesize = 0', 'memory_limit = 1024M', 'max_execution_time = 0',
    'output_buffering = 0', 'date.timezone = Europe/Warsaw', 'variables_order = "GPCS"',
  ];
  const f = userDir('php.ini');
  fs.writeFileSync(f, lines.join('\r\n') + '\r\n');
  return f;
}

const portFree = port => new Promise(res => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)));
  s.listen(port, '127.0.0.1');
});
function waitReady(url, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const rq = http.get(url, r => { r.resume(); resolve(); });
      rq.on('error', () => (Date.now() > until ? reject(new Error('Serwer programu nie odpowiada.')) : setTimeout(tryOnce, 120)));
      rq.setTimeout(2000, () => rq.destroy());
    };
    tryOnce();
  });
}

async function startServer() {
  fs.mkdirSync(userDir('logs'), { recursive: true });
  const dataDir = userDir('data');
  fs.mkdirSync(dataDir, { recursive: true });
  const php = path.join(runtimeDir(), 'php');
  const web = path.join(runtimeDir(), 'web');
  if (!fs.existsSync(path.join(php, 'php.exe')) || !fs.existsSync(path.join(web, 'router.php'))) {
    throw new Error('Brakuje plików programu (runtime). Zainstaluj CloudCut ponownie.');
  }
  let port = null;
  for (const p of PORTS) if (await portFree(p)) { port = p; break; }
  if (!port) throw new Error(`Porty ${PORTS[0]}–${PORTS.at(-1)} są zajęte przez inne programy.`);
  const log = fs.createWriteStream(userDir('logs', 'serwer.log'), { flags: 'w' });
  server = spawn(path.join(php, 'php.exe'), ['-c', writePhpIni(php), '-S', `127.0.0.1:${port}`, '-t', web, path.join(web, 'router.php')], {
    cwd: php,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // CLOUDCUT_DESKTOP: tylko wersja na komputer może podmieniać swoje pliki przy aktualizacji
    env: { ...process.env, CLOUDCUT_DATA: dataDir, CLOUDCUT_SECRET: secretKey(), CLOUDCUT_DESKTOP: '1', PHP_INI_SCAN_DIR: '' },
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', code => { if (!quitting) fatal(new Error(`Serwer programu zatrzymał się (kod ${code}).`)); });
  origin = `http://127.0.0.1:${port}`;
  await waitReady(origin + '/api/me', 20000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 680, show: false,
    backgroundColor: '#0d0e11', title: 'CloudCut', icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, spellcheck: false,
      additionalArguments: [`--cloudcut-version=${app.getVersion()}`],
    },
  });
  win.once('ready-to-show', () => {
    if (process.env.CLOUDCUT_TEST_WINDOW === 'offscreen') { // testy: okno poza ekranem, bez zabierania fokusu
      win.setBounds({ x: -4000, y: 0, width: 1440, height: 900 });
      win.showInactive();
      return;
    }
    win.maximize();
    win.show();
  });
  // linki do GitHuba, czcionek itp. — w zwykłej przeglądarce, nie w oknie programu
  const external = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(origin)) external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); external(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // przed zamknięciem: zapis otwartego projektu, ostrzeżenie o trwającej wysyłce plików lub na GitHuba
  win.on('close', async e => {
    if (closeConfirmed) return;
    e.preventDefault();
    let busy = [];
    try {
      busy = await win.webContents.executeJavaScript(`(async () => {
        const b = [];
        try { await flushSave(); } catch {}
        if (typeof Store !== 'undefined' && Store.uploading()) b.push('pliki projektu jeszcze się zapisują');
        if (typeof ghInfo !== 'undefined' && ghInfo?.status?.state === 'running') b.push('trwa wysyłka na GitHuba');
        return b;
      })()`);
    } catch { /* strona nie odpowiada — zamykamy */ }
    if (busy.length) {
      const r = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Poczekaj', 'Zamknij mimo to'], defaultId: 0, cancelId: 0, title: 'CloudCut',
        message: `Jeszcze chwila — ${busy.join(' i ')}.`,
        detail: 'Jeśli zamkniesz program teraz, to się przerwie. Wysyłka na GitHuba przy następnym razie dośle tylko to, czego brakuje.',
      });
      if (r.response === 0) return;
    }
    closeConfirmed = true;
    win.close();
  });
  win.loadURL(origin + '/');
}

function stopServer() {
  quitting = true;
  if (server && !server.killed) server.kill();
}
function fatal(err) {
  if (quitting) return;
  stopServer();
  dialog.showErrorBox('CloudCut', `${err.message}\n\nSzczegóły: ${userDir('logs')}`);
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  Menu.setApplicationMenu(null);
  app.whenReady().then(async () => {
    await startServer();
    createWindow();
  }).catch(fatal);
  app.on('window-all-closed', () => { stopServer(); app.quit(); });
  app.on('before-quit', stopServer);
}
