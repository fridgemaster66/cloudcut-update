<?php
declare(strict_types=1);
/*
 * CloudCut — API kont, projektów, plików i biblioteki assetów.
 * Baza: SQLite w data/cloudcut.sqlite, pliki: data/media/<id użytkownika>/<id>.bin, data/assets/<id użytkownika>/<id>.bin
 *
 *   GET    /api/me                          zalogowany użytkownik
 *   POST   /api/register | login | logout
 *   POST   /api/password                    zmiana hasła
 *   DELETE /api/account                     usunięcie konta (wymaga hasła)
 *   GET    /api/settings  PUT /api/settings
 *   GET    /api/stats                       zajęte miejsce i liczby
 *   GET    /api/projects[?trash=1]          lista projektów (albo kosza)
 *   GET    /api/projects/{id}               projekt + opisy plików
 *   PUT    /api/projects/{id}               zapis projektu (co 2 min tworzy też wersję w historii)
 *   DELETE /api/projects/{id}[?forever=1]   do kosza albo na zawsze
 *   POST   /api/projects/{id}/restore       wyjęcie z kosza
 *   POST   /api/projects/{id}/duplicate     kopia projektu {id, name}
 *   GET    /api/projects/{id}/versions[/{v}]  historia wersji
 *   PUT    /api/media/{id}  PUT|GET /api/media/{id}/file  DELETE /api/media/{id}
 *   GET    /api/assets   PUT /api/assets/{id}   PUT|GET /api/assets/{id}/file   DELETE /api/assets/{id}
 */
require __DIR__ . '/lib.php';

const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 8;        // nieudanych logowań na adres w ciągu 15 minut
const VERSION_EVERY = 120;     // sekund między wersjami w historii
const VERSIONS_KEEP = 40;
const TRASH_DAYS = 30;

function startSession(): void {
    session_save_path(DATA_DIR . '/sessions');
    session_name('cloudcut');
    ini_set('session.gc_maxlifetime', (string) (SESSION_DAYS * 86400));
    ini_set('session.use_strict_mode', '1');
    session_set_cookie_params([
        'lifetime' => SESSION_DAYS * 86400, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
}

function body(): array {
    $raw = file_get_contents('php://input', false, null, 0, 20_000_000);
    $data = json_decode($raw ?: '{}', true, 512, JSON_INVALID_UTF8_SUBSTITUTE);
    if (!is_array($data)) fail(400, 'Nieprawidłowe dane');
    return $data;
}
function userId(): int {
    $id = $_SESSION['uid'] ?? null;
    if (!$id) $id = loginFromRemember();
    if (!$id) fail(401, 'Zaloguj się');
    return (int) $id;
}

/* ---------------- Trwałe logowanie („Zapamiętaj mnie”) ---------------- */
const REMEMBER_DAYS = 90;
const REMEMBER_COOKIE = 'cloudcut_remember';
function rememberCookie(string $value, int $expires): void {
    setcookie(REMEMBER_COOKIE, $value, [
        'expires' => $expires, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
}
function issueRemember(int $uid): void {
    $selector = bin2hex(random_bytes(9));
    $validator = bin2hex(random_bytes(32));
    $expires = time() + REMEMBER_DAYS * 86400;
    db()->prepare('INSERT INTO remember_tokens (selector, hash, user_id, expires) VALUES (?,?,?,?)')
        ->execute([$selector, hash('sha256', $validator), $uid, $expires]);
    rememberCookie($selector . ':' . $validator, $expires);
}
function forgetRemember(): void {
    $raw = (string) ($_COOKIE[REMEMBER_COOKIE] ?? '');
    if ($raw !== '' && str_contains($raw, ':')) db()->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([explode(':', $raw, 2)[0]]);
    rememberCookie('', time() - 3600);
}
/* Sesja wygasła albo serwer ją skasował — odtwarzamy ją z tokenu i wymieniamy token na nowy */
function loginFromRemember(): ?int {
    $raw = (string) ($_COOKIE[REMEMBER_COOKIE] ?? '');
    if (!preg_match('/^([a-f0-9]{18}):([a-f0-9]{64})$/', $raw, $m)) return null;
    db()->prepare('DELETE FROM remember_tokens WHERE expires < ?')->execute([time()]);
    $q = db()->prepare('SELECT * FROM remember_tokens WHERE selector = ?');
    $q->execute([$m[1]]);
    $t = $q->fetch();
    if (!$t || !hash_equals($t['hash'], hash('sha256', $m[2]))) {
        // nieznany albo podrobiony token — usuwamy go po obu stronach
        if ($t) db()->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([$m[1]]);
        rememberCookie('', time() - 3600);
        return null;
    }
    db()->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([$m[1]]);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $t['user_id'];
    issueRemember((int) $t['user_id']);
    return (int) $t['user_id'];
}
function checkId(string $id): string {
    if (!preg_match(ID_RE, $id)) fail(400, 'Nieprawidłowy identyfikator');
    return $id;
}
function userPayload(array $u): array {
    return [
        'id' => (int) $u['id'], 'email' => $u['email'],
        'settings' => $u['settings'] ? json_decode($u['settings'], true) : null,
        'initialPassword' => (bool) ($u['pass_initial'] ?? 0),
    ];
}
function login(array $u, bool $remember = true): never {
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $u['id'];
    if ($remember) issueRemember((int) $u['id']);
    out(200, ['user' => userPayload($u)]);
}
function currentUser(int $uid): array {
    $q = db()->prepare('SELECT * FROM users WHERE id = ?');
    $q->execute([$uid]);
    $u = $q->fetch();
    if (!$u) { session_destroy(); fail(401, 'Zaloguj się'); }
    return $u;
}
function validPassword(string $pass): void {
    if (mb_strlen($pass) < 8) fail(422, 'Hasło musi mieć co najmniej 8 znaków');
    if (mb_strlen($pass) > 200) fail(422, 'Hasło jest za długie');
}
/* Pliki, których nie używa już żaden projekt użytkownika (także te w koszu) */
function removeOrphanMedia(int $uid, array $candidates): void {
    if (!$candidates) return;
    $used = [];
    $q = db()->prepare('SELECT media_ids FROM projects WHERE user_id = ?');
    $q->execute([$uid]);
    foreach ($q as $row) foreach (json_decode($row['media_ids'], true) ?: [] as $m) $used[$m] = true;
    $q = db()->prepare('SELECT media_ids FROM project_versions WHERE user_id = ?');
    $q->execute([$uid]);
    foreach ($q as $row) foreach (json_decode($row['media_ids'], true) ?: [] as $m) $used[$m] = true;
    $del = db()->prepare('DELETE FROM media WHERE id = ? AND user_id = ?');
    foreach ($candidates as $mid) {
        if (isset($used[$mid]) || !preg_match(ID_RE, (string) $mid)) continue;
        $del->execute([$mid, $uid]);
        $p = filePath('media', $uid, $mid);
        if (is_file($p)) @unlink($p);
    }
}
function purgeTrash(int $uid): void {
    $q = db()->prepare('SELECT id, media_ids FROM projects WHERE user_id = ? AND deleted IS NOT NULL AND deleted < ?');
    $q->execute([$uid, (time() - TRASH_DAYS * 86400) * 1000]);
    foreach ($q->fetchAll() as $p) hardDeleteProject($uid, $p['id']);
}
function hardDeleteProject(int $uid, string $id): void {
    $q = db()->prepare('SELECT media_ids FROM projects WHERE id = ? AND user_id = ?');
    $q->execute([$id, $uid]);
    $row = $q->fetch();
    if (!$row) return;
    $ids = json_decode($row['media_ids'], true) ?: [];
    $vq = db()->prepare('SELECT media_ids FROM project_versions WHERE project_id = ?');
    $vq->execute([$id]);
    foreach ($vq as $v) $ids = array_merge($ids, json_decode($v['media_ids'], true) ?: []);
    db()->prepare('DELETE FROM project_versions WHERE project_id = ?')->execute([$id]);
    db()->prepare('DELETE FROM projects WHERE id = ?')->execute([$id]);
    removeOrphanMedia($uid, array_unique($ids));
}
function sendFile(string $file, string $type): never {
    session_write_close(); // nie blokuj innych żądań podczas wysyłania dużego pliku
    $size = filesize($file);
    $start = 0; $end = $size - 1;
    header('Accept-Ranges: bytes');
    header('Content-Type: ' . ($type ?: 'application/octet-stream'));
    header('Cache-Control: private, max-age=31536000, immutable');
    header('X-Content-Type-Options: nosniff');
    if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'] ?? '', $rg)) {
        if ($rg[1] !== '') { $start = (int) $rg[1]; if ($rg[2] !== '') $end = min((int) $rg[2], $end); }
        elseif ($rg[2] !== '') { $start = max(0, $size - (int) $rg[2]); }
        if ($start > $end) { header("Content-Range: bytes */$size"); http_response_code(416); exit; }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    $fh = fopen($file, 'rb');
    fseek($fh, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($fh)) {
        $chunk = fread($fh, (int) min(1 << 20, $left));
        echo $chunk;
        $left -= strlen($chunk);
        flush();
    }
    fclose($fh);
    exit;
}
function receiveFile(string $dest): int {
    $in = fopen('php://input', 'rb');
    $outF = fopen($dest, 'wb');
    if (!$in || !$outF) fail(500, 'Nie udało się zapisać pliku');
    $size = stream_copy_to_stream($in, $outF);
    fclose($in); fclose($outF);
    return (int) $size;
}
function cleanType(): string {
    return substr(preg_replace('#[^a-z0-9/+.\-;=]#i', '', (string) ($_SERVER['CONTENT_TYPE'] ?? 'application/octet-stream')), 0, 100);
}
function projectRow(string $id, int $uid): ?array {
    $q = db()->prepare('SELECT * FROM projects WHERE id = ?');
    $q->execute([$id]);
    $p = $q->fetch();
    if ($p && (int) $p['user_id'] !== $uid) fail(404, 'Nie ma takiego projektu');
    return $p ?: null;
}

/* ---------------- Start ---------------- */
ensureDirs();
startSession();
$method = $_SERVER['REQUEST_METHOD'];
$path = trim(substr((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), strlen('/api/')), '/');
$seg = $path === '' ? [] : explode('/', $path);

// Ochrona przed CSRF: zmiany tylko z nagłówkiem, którego obca strona nie wyśle bez zgody (CORS)
if ($method !== 'GET' && ($_SERVER['HTTP_X_CLOUDCUT'] ?? '') !== '1') fail(403, 'Brak nagłówka aplikacji');

try {
    db();
    $r = $seg[0] ?? '';

    if ($r === 'me' && $method === 'GET') {
        out(200, ['user' => userPayload(currentUser(userId()))]);
    }

    if ($r === 'register' && $method === 'POST') {
        $b = body();
        $email = strtolower(trim((string) ($b['email'] ?? '')));
        $pass = (string) ($b['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) fail(422, 'Podaj poprawny adres e-mail');
        validPassword($pass);
        $q = db()->prepare('SELECT id FROM users WHERE email = ?');
        $q->execute([$email]);
        if ($q->fetch()) fail(409, 'Konto z tym adresem już istnieje — zaloguj się');
        db()->prepare('INSERT INTO users (email, pass, created) VALUES (?, ?, ?)')
            ->execute([$email, password_hash($pass, PASSWORD_DEFAULT), time()]);
        login(currentUser((int) db()->lastInsertId()), !isset($b['remember']) || !empty($b['remember']));
    }

    if ($r === 'login' && $method === 'POST') {
        $b = body();
        $email = strtolower(trim((string) ($b['email'] ?? '')));
        $pass = (string) ($b['password'] ?? '');
        $since = time() - 900;
        db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([$since]);
        $q = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE email = ? AND at >= ?');
        $q->execute([$email, $since]);
        if ((int) $q->fetchColumn() >= MAX_ATTEMPTS) fail(429, 'Za dużo nieudanych prób. Spróbuj ponownie za kwadrans.');
        $q = db()->prepare('SELECT * FROM users WHERE email = ?');
        $q->execute([$email]);
        $u = $q->fetch();
        if (!$u || !password_verify($pass, $u['pass'])) {
            db()->prepare('INSERT INTO login_attempts (email, at) VALUES (?, ?)')->execute([$email, time()]);
            usleep(400_000);
            fail(401, 'Nieprawidłowy e-mail lub hasło');
        }
        db()->prepare('DELETE FROM login_attempts WHERE email = ?')->execute([$email]);
        if (password_needs_rehash($u['pass'], PASSWORD_DEFAULT)) {
            db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
        }
        login($u, !isset($b['remember']) || !empty($b['remember']));
    }

    if ($r === 'logout' && $method === 'POST') {
        forgetRemember();
        $_SESSION = [];
        session_destroy();
        out(200, ['ok' => true]);
    }

    if ($r === 'password' && $method === 'POST') {
        $uid = userId();
        $b = body();
        $u = currentUser($uid);
        if (!password_verify((string) ($b['old'] ?? ''), $u['pass'])) fail(403, 'Obecne hasło jest nieprawidłowe');
        $new = (string) ($b['new'] ?? '');
        validPassword($new);
        if (password_verify($new, $u['pass'])) fail(422, 'Nowe hasło musi się różnić od obecnego');
        db()->prepare('UPDATE users SET pass = ?, pass_initial = 0 WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $uid]);
        // po zmianie hasła wylogowujemy inne urządzenia: stare tokeny „zapamiętaj mnie” przestają działać
        db()->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$uid]);
        session_regenerate_id(true);
        issueRemember($uid);
        out(200, ['ok' => true]);
    }

    if ($r === 'account' && $method === 'DELETE') {
        $uid = userId();
        $b = body();
        $u = currentUser($uid);
        if (!password_verify((string) ($b['password'] ?? ''), $u['pass'])) fail(403, 'Nieprawidłowe hasło');
        foreach (['media', 'assets'] as $kind) {
            $dir = DATA_DIR . '/' . $kind . '/' . $uid;
            foreach (glob($dir . '/*.bin') ?: [] as $f) @unlink($f);
            if (is_dir($dir)) @rmdir($dir);
        }
        foreach (glob(DATA_DIR . "/github/$uid.*") ?: [] as $f) @unlink($f);
        foreach (glob(DATA_DIR . "/youtube/$uid.*") ?: [] as $f) @unlink($f);
        db()->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
        rememberCookie('', time() - 3600);
        $_SESSION = [];
        session_destroy();
        out(200, ['ok' => true]);
    }

    if ($r === 'settings') {
        $uid = userId();
        if ($method === 'GET') {
            $q = db()->prepare('SELECT settings FROM users WHERE id = ?');
            $q->execute([$uid]);
            $s = $q->fetchColumn();
            out(200, ['settings' => $s ? json_decode($s, true) : null]);
        }
        if ($method === 'PUT') {
            $raw = json_encode(body(), JSON_UNESCAPED_UNICODE);
            if (strlen($raw) > 200_000) fail(413, 'Za duże ustawienia');
            db()->prepare('UPDATE users SET settings = ? WHERE id = ?')->execute([$raw, $uid]);
            out(200, ['ok' => true]);
        }
    }

    if ($r === 'stats' && $method === 'GET') {
        $uid = userId();
        $one = function (string $sql) use ($uid) { $q = db()->prepare($sql); $q->execute([$uid]); return (float) $q->fetchColumn(); };
        out(200, [
            'projects' => (int) $one('SELECT COUNT(*) FROM projects WHERE user_id = ? AND deleted IS NULL'),
            'trash' => (int) $one('SELECT COUNT(*) FROM projects WHERE user_id = ? AND deleted IS NOT NULL'),
            'media' => (int) $one('SELECT COUNT(*) FROM media WHERE user_id = ?'),
            'mediaBytes' => $one('SELECT COALESCE(SUM(size),0) FROM media WHERE user_id = ?'),
            'assets' => (int) $one('SELECT COUNT(*) FROM assets WHERE user_id = ?'),
            'assetBytes' => $one('SELECT COALESCE(SUM(size),0) FROM assets WHERE user_id = ?'),
            'versions' => (int) $one('SELECT COUNT(*) FROM project_versions WHERE user_id = ?'),
        ]);
    }

    if ($r === 'projects') {
        $uid = userId();
        $id = isset($seg[1]) ? checkId($seg[1]) : null;
        $sub = $seg[2] ?? '';
        if (!$id && $method === 'GET') {
            purgeTrash($uid);
            $trash = !empty($_GET['trash']);
            $q = db()->prepare('SELECT id, name, updated, duration, thumb, media_ids, deleted FROM projects WHERE user_id = ? AND deleted IS '
                . ($trash ? 'NOT NULL ORDER BY deleted DESC' : 'NULL ORDER BY updated DESC'));
            $q->execute([$uid]);
            $vq = db()->prepare('SELECT project_id, COUNT(*) n FROM project_versions WHERE user_id = ? GROUP BY project_id');
            $vq->execute([$uid]);
            $vc = array_column($vq->fetchAll(), 'n', 'project_id');
            $list = array_map(fn($p) => [
                'id' => $p['id'], 'name' => $p['name'], 'updated' => (int) $p['updated'], 'duration' => (float) $p['duration'],
                'thumb' => $p['thumb'], 'mediaIds' => json_decode($p['media_ids'], true) ?: [],
                'deleted' => $p['deleted'] ? (int) $p['deleted'] : null, 'versions' => (int) ($vc[$p['id']] ?? 0),
            ], $q->fetchAll());
            out(200, ['projects' => $list]);
        }
        if ($id) {
            $p = projectRow($id, $uid);
            if ($sub === 'versions' && $method === 'GET') {
                if (!$p) fail(404, 'Nie ma takiego projektu');
                if (isset($seg[3])) {
                    $q = db()->prepare('SELECT * FROM project_versions WHERE id = ? AND project_id = ? AND user_id = ?');
                    $q->execute([(int) $seg[3], $id, $uid]);
                    $v = $q->fetch();
                    if (!$v) fail(404, 'Nie ma takiej wersji');
                    out(200, ['version' => ['id' => (int) $v['id'], 'name' => $v['name'], 'data' => $v['data'], 'mediaIds' => json_decode($v['media_ids'], true) ?: [], 'created' => (int) $v['created']]]);
                }
                $q = db()->prepare('SELECT id, name, duration, created FROM project_versions WHERE project_id = ? AND user_id = ? ORDER BY created DESC');
                $q->execute([$id, $uid]);
                out(200, ['versions' => array_map(fn($v) => ['id' => (int) $v['id'], 'name' => $v['name'], 'duration' => (float) $v['duration'], 'created' => (int) $v['created']], $q->fetchAll())]);
            }
            if ($sub === 'restore' && $method === 'POST') {
                if (!$p) fail(404, 'Nie ma takiego projektu');
                db()->prepare('UPDATE projects SET deleted = NULL WHERE id = ?')->execute([$id]);
                out(200, ['ok' => true]);
            }
            if ($sub === 'duplicate' && $method === 'POST') {
                if (!$p) fail(404, 'Nie ma takiego projektu');
                $b = body();
                $newId = checkId((string) ($b['id'] ?? ''));
                if (projectRow($newId, $uid)) fail(409, 'Taki projekt już istnieje');
                $name = mb_substr(trim((string) ($b['name'] ?? ($p['name'] . ' (kopia)'))), 0, 200);
                $now = (int) round(microtime(true) * 1000);
                db()->prepare('INSERT INTO projects (id, user_id, name, data, media_ids, duration, thumb, updated) VALUES (?,?,?,?,?,?,?,?)')
                    ->execute([$newId, $uid, $name, $p['data'], $p['media_ids'], $p['duration'], $p['thumb'], $now]);
                out(200, ['ok' => true, 'id' => $newId]);
            }
            if ($sub === '' && $method === 'GET') {
                if (!$p) fail(404, 'Nie ma takiego projektu');
                $ids = json_decode($p['media_ids'], true) ?: [];
                $media = [];
                if ($ids) {
                    $in = implode(',', array_fill(0, count($ids), '?'));
                    $mq = db()->prepare("SELECT id, meta, has_file, size, type FROM media WHERE user_id = ? AND id IN ($in)");
                    $mq->execute([$uid, ...$ids]);
                    foreach ($mq->fetchAll() as $m) {
                        $media[] = ['meta' => json_decode($m['meta'], true), 'hasFile' => (bool) $m['has_file'], 'size' => (int) $m['size'], 'type' => $m['type']];
                    }
                }
                out(200, ['project' => [
                    'id' => $p['id'], 'name' => $p['name'], 'data' => $p['data'], 'updated' => (int) $p['updated'],
                    'mediaIds' => $ids, 'duration' => (float) $p['duration'], 'thumb' => $p['thumb'], 'deleted' => $p['deleted'],
                ], 'media' => $media]);
            }
            if ($sub === '' && $method === 'PUT') {
                $b = body();
                $name = mb_substr(trim((string) ($b['name'] ?? 'Bez nazwy')), 0, 200) ?: 'Bez nazwy';
                $data = (string) ($b['data'] ?? '');
                if ($data === '' || json_decode($data) === null) fail(422, 'Brak danych projektu');
                $mediaIds = array_values(array_filter((array) ($b['mediaIds'] ?? []), fn($m) => is_string($m) && preg_match(ID_RE, $m)));
                $thumb = (string) ($b['thumb'] ?? '');
                if (strlen($thumb) > 200_000 || ($thumb && !str_starts_with($thumb, 'data:image/'))) $thumb = '';
                $updated = (int) round(microtime(true) * 1000);
                $old = $p ? (json_decode($p['media_ids'], true) ?: []) : [];
                $mids = json_encode($mediaIds);
                $dur = (float) ($b['duration'] ?? 0);
                db()->prepare('INSERT INTO projects (id, user_id, name, data, media_ids, duration, thumb, updated) VALUES (?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, media_ids=excluded.media_ids,
                    duration=excluded.duration, thumb=excluded.thumb, updated=excluded.updated, deleted=NULL')
                    ->execute([$id, $uid, $name, $data, $mids, $dur, $thumb ?: null, $updated]);
                // wersja do historii najwyżej co VERSION_EVERY sekund
                $lq = db()->prepare('SELECT MAX(created) FROM project_versions WHERE project_id = ?');
                $lq->execute([$id]);
                $last = (int) $lq->fetchColumn();
                if (!empty($b['version']) || time() - $last >= VERSION_EVERY) {
                    db()->prepare('INSERT INTO project_versions (project_id, user_id, name, data, media_ids, duration, created) VALUES (?,?,?,?,?,?,?)')
                        ->execute([$id, $uid, $name, $data, $mids, $dur, time()]);
                    $old2 = db()->prepare('SELECT id, media_ids FROM project_versions WHERE project_id = ? ORDER BY created DESC LIMIT -1 OFFSET ' . VERSIONS_KEEP);
                    $old2->execute([$id]);
                    $drop = $old2->fetchAll();
                    if ($drop) {
                        $del = db()->prepare('DELETE FROM project_versions WHERE id = ?');
                        $freed = [];
                        foreach ($drop as $d) { $del->execute([$d['id']]); $freed = array_merge($freed, json_decode($d['media_ids'], true) ?: []); }
                        removeOrphanMedia($uid, array_unique($freed));
                    }
                }
                removeOrphanMedia($uid, array_diff($old, $mediaIds));
                out(200, ['ok' => true, 'updated' => $updated]);
            }
            if ($sub === '' && $method === 'DELETE') {
                if ($p) {
                    if (!empty($_GET['forever'])) hardDeleteProject($uid, $id);
                    else db()->prepare('UPDATE projects SET deleted = ? WHERE id = ?')->execute([(int) round(microtime(true) * 1000), $id]);
                }
                out(200, ['ok' => true]);
            }
        }
    }

    if ($r === 'media' && isset($seg[1])) {
        $uid = userId();
        $id = checkId($seg[1]);
        $q = db()->prepare('SELECT * FROM media WHERE id = ?');
        $q->execute([$id]);
        $m = $q->fetch();
        if ($m && (int) $m['user_id'] !== $uid) fail(404, 'Nie ma takiego pliku');
        $isFile = ($seg[2] ?? '') === 'file';

        if (!$isFile && $method === 'PUT') {
            $raw = file_get_contents('php://input', false, null, 0, 8_000_000);
            $meta = json_decode($raw ?: '', true);
            if (!is_array($meta)) fail(400, 'Nieprawidłowy opis pliku');
            $meta['id'] = $id;
            db()->prepare('INSERT INTO media (id, user_id, meta, updated) VALUES (?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET meta=excluded.meta, updated=excluded.updated')
                ->execute([$id, $uid, json_encode($meta, JSON_UNESCAPED_UNICODE), time()]);
            out(200, ['ok' => true]);
        }
        if ($isFile && $method === 'PUT') {
            $type = cleanType();
            $size = receiveFile(filePath('media', $uid, $id));
            if ($m) db()->prepare('UPDATE media SET has_file = 1, size = ?, type = ?, updated = ? WHERE id = ?')->execute([$size, $type, time(), $id]);
            else db()->prepare('INSERT INTO media (id, user_id, meta, type, size, has_file, updated) VALUES (?,?,?,?,?,1,?)')
                ->execute([$id, $uid, json_encode(['id' => $id]), $type, $size, time()]);
            out(200, ['ok' => true, 'size' => $size]);
        }
        if ($isFile && $method === 'GET') {
            $file = filePath('media', $uid, $id);
            if (!$m || !is_file($file)) fail(404, 'Brak pliku na serwerze');
            sendFile($file, (string) $m['type']);
        }
        if (!$isFile && $method === 'DELETE') {
            removeOrphanMedia($uid, [$id]);
            out(200, ['ok' => true]);
        }
    }

    if ($r === 'assets') {
        $uid = userId();
        if (!isset($seg[1]) && $method === 'GET') {
            $q = db()->prepare('SELECT id, kind, name, data, type, size, has_file, fav, created FROM assets WHERE user_id = ? ORDER BY fav DESC, created DESC');
            $q->execute([$uid]);
            out(200, ['assets' => array_map(fn($a) => [
                'id' => $a['id'], 'kind' => $a['kind'], 'name' => $a['name'], 'data' => $a['data'] ? json_decode($a['data'], true) : null,
                'type' => $a['type'], 'size' => (int) $a['size'], 'hasFile' => (bool) $a['has_file'], 'fav' => (bool) $a['fav'], 'created' => (int) $a['created'],
            ], $q->fetchAll())]);
        }
        if (isset($seg[1])) {
            $id = checkId($seg[1]);
            $q = db()->prepare('SELECT * FROM assets WHERE id = ?');
            $q->execute([$id]);
            $a = $q->fetch();
            if ($a && (int) $a['user_id'] !== $uid) fail(404, 'Nie ma takiego assetu');
            $isFile = ($seg[2] ?? '') === 'file';
            if (!$isFile && $method === 'PUT') {
                $b = body();
                $kind = preg_replace('/[^a-z\-]/', '', (string) ($b['kind'] ?? 'preset')) ?: 'preset';
                $name = mb_substr(trim((string) ($b['name'] ?? 'Asset')), 0, 120) ?: 'Asset';
                $data = json_encode($b['data'] ?? null, JSON_UNESCAPED_UNICODE);
                if (strlen($data) > 4_000_000) fail(413, 'Za duży asset');
                db()->prepare('INSERT INTO assets (id, user_id, kind, name, data, fav, created) VALUES (?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, data=excluded.data, fav=excluded.fav')
                    ->execute([$id, $uid, $kind, $name, $data, !empty($b['fav']) ? 1 : 0, time()]);
                out(200, ['ok' => true]);
            }
            if ($isFile && $method === 'PUT') {
                if (!$a) fail(404, 'Najpierw zapisz opis assetu');
                $size = receiveFile(filePath('assets', $uid, $id));
                db()->prepare('UPDATE assets SET has_file = 1, size = ?, type = ? WHERE id = ?')->execute([$size, cleanType(), $id]);
                out(200, ['ok' => true, 'size' => $size]);
            }
            if ($isFile && $method === 'GET') {
                $file = filePath('assets', $uid, $id);
                if (!$a || !is_file($file)) fail(404, 'Brak pliku assetu');
                sendFile($file, (string) $a['type']);
            }
            if (!$isFile && $method === 'DELETE') {
                if ($a) {
                    db()->prepare('DELETE FROM assets WHERE id = ?')->execute([$id]);
                    $f = filePath('assets', $uid, $id);
                    if (is_file($f)) @unlink($f);
                }
                out(200, ['ok' => true]);
            }
        }
    }

    if ($r === 'github' || $r === 'update') $GLOBALS['ghNoWait'] = true;

    if ($r === 'youtube') {
        require_once __DIR__ . '/youtube.php';
        $sub = $seg[1] ?? '';
        // powrót z logowania Google otwiera się w przeglądarce systemowej — bez sesji programu, użytkownik z „state”
        if ($sub === 'callback' && $method === 'GET') {
            try { [$ok, $msg] = ytCallback((string) ($_GET['state'] ?? ''), (string) ($_GET['code'] ?? ''), (string) ($_GET['error'] ?? '')); }
            catch (YtError $e) { [$ok, $msg] = [false, $e->getMessage()]; }
            ytCallbackPage($ok, $msg);
        }
        $uid = userId();
        try {
            if ($sub === '' && $method === 'GET') out(200, ytPublic($uid));
            if ($sub === '' && $method === 'PUT') {
                $b = body();
                $c = ytConfig($uid);
                $id = trim((string) ($b['clientId'] ?? ''));
                if (!preg_match('/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/', $id)) fail(422, 'Client ID wygląda inaczej — kończy się na „.apps.googleusercontent.com”.');
                $secret = trim((string) ($b['clientSecret'] ?? ''));
                if ($id !== ($c['clientId'] ?? '')) { unset($c['refresh'], $c['access'], $c['accessExp'], $c['channel'], $c['connectedAt']); } // inny klient = nowe połączenie
                $c['clientId'] = $id;
                if ($secret !== '') $c['clientSecret'] = sealToken($secret);
                if (empty($c['clientSecret'])) fail(422, 'Wklej też Client secret.');
                ytSave($uid, $c);
                out(200, ytPublic($uid));
            }
            if ($sub === 'connect' && $method === 'POST') out(200, ['url' => ytConnectUrl($uid)]);
            if ($sub === 'token' && $method === 'POST') out(200, ytAccessToken($uid));
            if ($sub === 'disconnect' && $method === 'POST') { ytDisconnect($uid); out(200, ytPublic($uid)); }
        } catch (YtError $e) {
            fail(502, $e->getMessage());
        }
    }

    if ($r === 'github') {
        require_once __DIR__ . '/github.php';
        $uid = userId();
        $sub = $seg[1] ?? '';
        try {
            if ($sub === '' && $method === 'GET') out(200, ghPublic($uid));
            if ($sub === '' && $method === 'PUT') {
                $b = body();
                $set = [];
                if (array_key_exists('repo', $b)) {
                    $repo = trim((string) $b['repo']);
                    if ($repo !== '' && !parseRepo($repo)) fail(422, 'Nieprawidłowy adres repozytorium — wklej link w rodzaju https://github.com/twoja-nazwa/cloudcat-project001');
                    $set['repo'] = $repo;
                }
                if (array_key_exists('branch', $b)) {
                    $br = trim((string) $b['branch']);
                    if ($br !== '' && !ghValidBranch($br)) fail(422, 'Nieprawidłowa nazwa gałęzi');
                    $set['branch'] = $br;
                }
                if (!empty($b['clearToken'])) {
                    $set += ['token' => null, 'token_hint' => null, 'login' => null, 'auth' => null];
                } elseif (trim((string) ($b['token'] ?? '')) !== '') {
                    $tok = trim((string) $b['token']);
                    if (!preg_match('/^[A-Za-z0-9_]{20,255}$/', $tok)) fail(422, 'To nie wygląda na token GitHub — skopiuj go jeszcze raz (zaczyna się od ghp_ albo github_pat_).');
                    $set += ['token' => sealToken($tok), 'token_hint' => substr($tok, 0, (int) strrpos($tok, '_') + 1) . '…' . substr($tok, -4), 'login' => null, 'auth' => 'token'];
                }
                ghSaveConfig($uid, $set);
                out(200, ghPublic($uid));
            }
            if ($sub === 'use-git' && $method === 'POST') {
                // „Użyj konta GitHub z tego komputera”: logowanie gita (Git Credential Manager) zamiast wklejanego tokenu
                if (ghGitToken() === null) fail(424, 'Git na tym komputerze nie jest zalogowany do GitHuba. Wklej token albo zaloguj gita (np. przy pierwszym „git push”).');
                ghSaveConfig($uid, ['auth' => 'git', 'token' => null, 'token_hint' => null, 'login' => null]);
                out(200, ghPublic($uid));
            }
            if ($sub === 'check' && $method === 'POST') out(200, ghCheck($uid));
            if ($sub === 'create' && $method === 'POST') out(200, ghCreateRepo($uid));
            if ($sub === 'status' && $method === 'GET') out(200, ['status' => ghStatus($uid)]);
            if ($sub === 'push' && $method === 'POST') {
                $ids = array_values(array_unique(array_filter((array) (body()['projects'] ?? []), fn($i) => is_string($i) && preg_match(ID_RE, $i))));
                if (!$ids) fail(422, 'Zaznacz projekty do wysłania');
                $in = implode(',', array_fill(0, count($ids), '?'));
                $q = db()->prepare("SELECT id FROM projects WHERE user_id = ? AND deleted IS NULL AND id IN ($in)");
                $q->execute([$uid, ...$ids]);
                $ids = array_column($q->fetchAll(), 'id');
                if (!$ids) fail(404, 'Nie ma takich projektów');
                $cfg = ghConfig($uid);
                if (!ghHasAuth($cfg) || !parseRepo((string) $cfg['repo'])) fail(428, 'Najpierw połącz GitHuba w Ustawieniach (konto z tego komputera albo token) i podaj link do repozytorium');
                if (($st = ghStatus($uid)) && $st['state'] === 'running') fail(409, 'Trwa inne zadanie z GitHubem — poczekaj, aż się skończy');
                ghStartWorker($uid, ['type' => 'push', 'projects' => $ids]);
                out(200, ['status' => ghStatus($uid)]);
            }
            if ($sub === 'projects' && $method === 'GET') out(200, ghListProjects($uid));
            if ($sub === 'thumb' && $method === 'GET') {
                $f = ghThumbFile($uid, (string) ($_GET['folder'] ?? ''));
                if (!$f) fail(404, 'Brak miniatury');
                sendFile($f[0], $f[1]);
            }
            if ($sub === 'import' && $method === 'POST') {
                $folder = (string) (body()['folder'] ?? '');
                if (!preg_match('#^projekty/[A-Za-z0-9._-]+$#', $folder)) fail(422, 'Nieprawidłowy projekt');
                if (($st = ghStatus($uid)) && $st['state'] === 'running') fail(409, 'Trwa inne zadanie z GitHubem — poczekaj, aż się skończy');
                ghStartWorker($uid, ['type' => 'import', 'folder' => $folder]);
                out(200, ['status' => ghStatus($uid)]);
            }
            if ($sub === 'delete' && $method === 'POST') {
                $folder = (string) (body()['folder'] ?? '');
                if (!preg_match('#^projekty/[A-Za-z0-9._-]+$#', $folder)) fail(422, 'Nieprawidłowy projekt');
                if (!ghHasAuth(ghConfig($uid))) fail(428, 'Usuwanie z GitHuba wymaga połączenia w Ustawieniach (konto z tego komputera albo token)');
                if (($st = ghStatus($uid)) && $st['state'] === 'running') fail(409, 'Trwa inne zadanie z GitHubem — poczekaj, aż się skończy');
                out(200, ghDeleteRemoteProject($uid, $folder));
            }
        } catch (GhError $e) {
            fail(502, $e->getMessage());
        }
    }

    if ($r === 'update') {
        require_once __DIR__ . '/update.php';
        $uid = userId();
        $sub = $seg[1] ?? '';
        try {
            if ($sub === '' && $method === 'GET') out(200, updPublic());
            if ($sub === '' && $method === 'PUT') {
                $b = body();
                $set = [];
                if (array_key_exists('repo', $b)) {
                    $repo = trim((string) $b['repo']);
                    $p = $repo === '' ? null : parseRepo($repo);
                    if ($repo !== '' && !($p && $p[0])) fail(422, 'Wklej pełny link do repozytorium, np. https://github.com/twoja-nazwa/cloudcut');
                    $set['repo'] = $repo;
                }
                if (array_key_exists('branch', $b)) {
                    $br = trim((string) $b['branch']);
                    if ($br !== '' && !ghValidBranch($br)) fail(422, 'Nieprawidłowa nazwa gałęzi');
                    $set['branch'] = $br;
                }
                if (array_key_exists('mode', $b)) {
                    if (!in_array($b['mode'], UPD_MODES, true)) fail(422, 'Nieznany sposób sprawdzania');
                    $set['mode'] = $b['mode'];
                }
                $before = updRepoKey(updConfig());
                $c = updSave($set);
                if (updRepoKey($c) !== $before) updSave(['lastResult' => null, 'etag' => null, 'defaultBranch' => null]);
                out(200, updPublic());
            }
            if ($sub === 'check' && $method === 'POST') out(200, updCheck($uid));
            if ($sub === 'poll' && $method === 'POST') out(200, updPoll($uid));
            if ($sub === 'history' && $method === 'GET') {
                // zakładka Aktualizacje: każda część osobno, żeby błąd jednej nie chował reszty
                $h = ['commits' => []];
                $check = $commitsError = $checkError = null;
                try { $h = updCommits($uid); } catch (GhError $e) { $commitsError = $e->getMessage(); }
                try { $check = updPoll($uid); } catch (GhError $e) { $checkError = $e->getMessage(); }
                $c = updConfig();
                out(200, $h + ['check' => $check, 'checkError' => $checkError, 'commitsError' => $commitsError, 'log' => $c['log'] ?: [],
                    'installed' => $c['installed'], 'lastCheck' => $c['lastCheck'], 'backup' => (bool) $c['backup'], 'mode' => $c['mode'], 'canApply' => updCanApply()]);
            }
            if ($sub === 'apply' && $method === 'POST') out(200, updApply($uid));
            if ($sub === 'rollback' && $method === 'POST') out(200, updRollback());
        } catch (GhError $e) {
            fail(502, $e->getMessage());
        }
    }

    fail(404, 'Nieznane polecenie');
} catch (PDOException $e) {
    error_log('CloudCut DB: ' . $e->getMessage());
    fail(500, 'Błąd bazy danych');
}
