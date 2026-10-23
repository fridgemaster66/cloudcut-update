<?php
declare(strict_types=1);
/*
 * CloudCut — wspólne funkcje serwera: katalog danych, baza SQLite, odpowiedzi JSON.
 * Używa ich api.php (żądania z programu) i github-push.php (wysyłka „Zapisz całość” w osobnym procesie).
 *
 * Katalog danych: zmienna CLOUDCUT_DATA (wersja na komputer trzyma dane w %APPDATA%\CloudCut\data),
 * a bez niej data/ obok programu.
 */

define('DATA_DIR', rtrim(getenv('CLOUDCUT_DATA') ?: __DIR__ . '/../data', '/\\'));
const ID_RE = '/^[a-z0-9]{4,48}$/i';

function out(int $code, $body = null): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body ?? new stdClass(), JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(int $code, string $msg): never { out($code, ['error' => $msg]); }

function ensureDirs(): void {
    foreach ([DATA_DIR, DATA_DIR . '/sessions', DATA_DIR . '/media', DATA_DIR . '/assets', DATA_DIR . '/github'] as $d) {
        if (!is_dir($d)) mkdir($d, 0770, true);
    }
}

function hasColumn(PDO $pdo, string $table, string $col): bool {
    foreach ($pdo->query("PRAGMA table_info($table)") as $c) if ($c['name'] === $col) return true;
    return false;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . DATA_DIR . '/cloudcut.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass TEXT NOT NULL,
        settings TEXT,
        created INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        media_ids TEXT NOT NULL,
        duration REAL NOT NULL DEFAULT 0,
        thumb TEXT,
        updated INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        meta TEXT NOT NULL,
        type TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        has_file INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS project_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        media_ids TEXT NOT NULL,
        duration REAL NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        data TEXT,
        type TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        has_file INTEGER NOT NULL DEFAULT 0,
        fav INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, at INTEGER NOT NULL)');
    // „Zapamiętaj mnie”: w bazie tylko skrót tajnej części tokenu
    $pdo->exec('CREATE TABLE IF NOT EXISTS remember_tokens (
        selector TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL
    )');
    // „Zapisz na GitHub”: repozytorium, konto i zaszyfrowany token GitHuba
    $pdo->exec('CREATE TABLE IF NOT EXISTS github_sync (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        repo TEXT NOT NULL DEFAULT \'\',
        branch TEXT NOT NULL DEFAULT \'\',
        token TEXT,
        token_hint TEXT,
        login TEXT,
        last_push INTEGER,
        last_url TEXT
    )');
    // migracje starszych baz
    if (!hasColumn($pdo, 'github_sync', 'login')) $pdo->exec('ALTER TABLE github_sync ADD COLUMN login TEXT');
    // sposób logowania do GitHuba: 'token' (wklejony) albo 'git' (konto zalogowane w gicie na tym komputerze)
    if (!hasColumn($pdo, 'github_sync', 'auth')) $pdo->exec('ALTER TABLE github_sync ADD COLUMN auth TEXT');
    if (!hasColumn($pdo, 'projects', 'deleted')) $pdo->exec('ALTER TABLE projects ADD COLUMN deleted INTEGER');
    if (!hasColumn($pdo, 'users', 'pass_initial')) $pdo->exec('ALTER TABLE users ADD COLUMN pass_initial INTEGER NOT NULL DEFAULT 0');
    $pdo->exec('CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS media_user ON media(user_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS versions_project ON project_versions(project_id, created)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS assets_user ON assets(user_id)');
    seedAccounts($pdo);
    return $pdo;
}

function seedAccounts(PDO $pdo): void {
    $cfgFile = __DIR__ . '/config.php';
    if (!is_file($cfgFile)) return;
    $cfg = require $cfgFile;
    foreach ($cfg['seed_accounts'] ?? [] as $a) {
        $q = $pdo->prepare('SELECT id FROM users WHERE email = ?');
        $q->execute([$a['email']]);
        if ($q->fetch()) continue;
        $pdo->prepare('INSERT INTO users (email, pass, created, pass_initial) VALUES (?, ?, ?, 1)')
            ->execute([strtolower($a['email']), $a['hash'], time()]);
    }
}

function filePath(string $kind, int $uid, string $id): string {
    $dir = DATA_DIR . '/' . $kind . '/' . $uid;
    if (!is_dir($dir)) mkdir($dir, 0770, true);
    return $dir . '/' . $id . '.bin';
}
