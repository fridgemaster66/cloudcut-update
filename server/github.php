<?php
declare(strict_types=1);
/*
 * CloudCut — wysyłka wybranych projektów do repozytorium GitHub („Zapisz na GitHub”).
 *
 * Każdy projekt ląduje w osobnym folderze projekty/<nazwa>-<id>/: projekt.json (montaż), miniatura.jpg
 * i media/ (pliki wideo, audio, zdjęcia). W katalogu głównym repozytorium są spis cloudcut.json i README.
 * Wysyłka idzie przez Git Data API (bloby → drzewo → commit → przesunięcie gałęzi), więc nie wymaga gita.
 * Pliki od GH_LFS_FROM idą przez Git LFS — GitHub nie przyjmuje zwykłych plików powyżej 100 MB.
 *
 * Token leży w bazie zaszyfrowany (AES-256-GCM) i nigdy nie wraca do okna programu. Klucz szyfrowania
 * daje program na komputer (CLOUDCUT_SECRET, chroniony przez Windows), a bez niego leży w data/secret.key.
 */

const GH_LFS_FROM = 50 * 1048576;
const GH_LFS_MAX = 2 * 1073741824;  // limit GitHub LFS na plik w darmowym planie
const GH_INLINE_MAX = 900_000;      // tekst do tylu bajtów idzie od razu w drzewie, bez osobnego bloba
const GH_STALE = 180;               // tyle sekund bez znaku życia = wysyłka się przerwała

class GhError extends RuntimeException {}

function ghApi(): string { return rtrim(getenv('CLOUDCUT_GITHUB_API') ?: 'https://api.github.com', '/'); }
function ghWeb(): string { return rtrim(getenv('CLOUDCUT_GITHUB_WEB') ?: 'https://github.com', '/'); }

/* ---------------- Szyfrowanie tokenu ---------------- */
function secretKey(): string {
    $env = (string) getenv('CLOUDCUT_SECRET');
    if (preg_match('/^[a-f0-9]{64}$/', $env)) return hex2bin($env);
    $f = DATA_DIR . '/secret.key';
    if (!is_file($f)) { file_put_contents($f, bin2hex(random_bytes(32))); @chmod($f, 0600); }
    return hex2bin(trim((string) file_get_contents($f)));
}
function sealToken(string $plain): string {
    $iv = random_bytes(12);
    $ct = openssl_encrypt($plain, 'aes-256-gcm', secretKey(), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $ct);
}
function openToken(?string $sealed): ?string {
    if (!$sealed) return null;
    $raw = base64_decode($sealed, true);
    if ($raw === false || strlen($raw) < 29) return null;
    $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', secretKey(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $plain === false ? null : $plain;
}

/* ---------------- Ustawienia ---------------- */
function parseRepo(string $s): ?array {
    $s = trim($s);
    $ok = fn(string $n) => $n !== '.' && $n !== '..' && strlen($n) <= 100 && !str_ends_with(strtolower($n), '.git');
    if (preg_match('~^(?:https?://(?:www\.)?github\.com/|git@github\.com:)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$~', $s, $m)) {
        return $ok($m[2]) ? [$m[1], $m[2]] : null;
    }
    // sama nazwa repozytorium — właściciel to konto, do którego należy token
    if (preg_match('~^[A-Za-z0-9._-]{1,100}$~', $s) && $ok($s)) return [null, $s];
    return null;
}
function ghValidBranch(string $b): bool {
    return (bool) preg_match('~^(?!/)(?!.*\.\.)(?!.*//)[A-Za-z0-9._/-]{1,100}(?<!/)(?<!\.lock)$~', $b);
}
function ghConfig(int $uid): array {
    $q = db()->prepare('SELECT * FROM github_sync WHERE user_id = ?');
    $q->execute([$uid]);
    return $q->fetch() ?: ['user_id' => $uid, 'repo' => '', 'branch' => '', 'token' => null, 'token_hint' => null, 'login' => null, 'last_push' => null, 'last_url' => null];
}
function ghSaveConfig(int $uid, array $set): void {
    $c = array_merge(ghConfig($uid), $set);
    db()->prepare('INSERT INTO github_sync (user_id, repo, branch, token, token_hint, login, last_push, last_url) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET repo=excluded.repo, branch=excluded.branch, token=excluded.token, token_hint=excluded.token_hint,
        login=excluded.login, last_push=excluded.last_push, last_url=excluded.last_url')
        ->execute([$uid, $c['repo'], $c['branch'], $c['token'], $c['token_hint'], $c['login'], $c['last_push'], $c['last_url']]);
}
/* To, co widzi okno programu — bez tokenu */
function ghPublic(int $uid): array {
    $c = ghConfig($uid);
    $repo = parseRepo((string) $c['repo']);
    $owner = $repo ? ($repo[0] ?? $c['login']) : null;
    return [
        'repo' => (string) $c['repo'],
        'repoName' => $repo && $owner ? "$owner/$repo[1]" : ($repo ? $repo[1] : null),
        'repoUrl' => $repo && $owner ? ghWeb() . "/$owner/$repo[1]" : null,
        'branch' => (string) $c['branch'],
        'hasToken' => (bool) $c['token'],
        'tokenHint' => $c['token_hint'],
        'tokenReadable' => !$c['token'] || openToken($c['token']) !== null,
        'login' => $c['login'],
        'lastPush' => $c['last_push'] ? (int) $c['last_push'] : null,
        'lastUrl' => $c['last_url'],
        'pushed' => ghPushed($uid) ?: new stdClass(),
        'status' => ghStatus($uid),
    ];
}
/* Które projekty są na GitHubie i w jakiej wersji: id => {at: czas wysyłki, updated: znacznik zmian projektu} */
function ghPushed(int $uid): array {
    return json_decode((string) @file_get_contents(DATA_DIR . "/github/$uid.pushed.json"), true) ?: [];
}
function ghMarkPushed(int $uid, array $projects): void {
    $all = ghPushed($uid);
    foreach ($projects as $p) $all[$p['id']] = ['at' => time(), 'updated' => (int) $p['updated']];
    file_put_contents(DATA_DIR . "/github/$uid.pushed.json", json_encode($all), LOCK_EX);
}
function ghToken(array $cfg): string {
    if (!$cfg['token']) throw new GhError('Nie ma jeszcze tokenu GitHub — wklej go w Ustawieniach.');
    $t = openToken($cfg['token']);
    if ($t === null) throw new GhError('Zapisanego tokenu nie da się odczytać na tym komputerze — wklej go ponownie w Ustawieniach.');
    return $t;
}

/* ---------------- HTTP ---------------- */
function ghNote(string $msg): void { ghReport(['note' => $msg], true); }
function ghReport(array $p, bool $force = false): void {
    static $last = 0.0;
    $cb = $GLOBALS['ghProgress'] ?? null;
    if (!$cb) return;
    $now = microtime(true);
    if (!$force && $now - $last < 0.5) return;
    $last = $now;
    $cb($p);
}

/*
 * Jedno żądanie do GitHuba. Czeka i ponawia przy limitach tempa i błędach 5xx.
 * $o: headers (zastępują domyślne), auth: bearer|basic|none, upload: ścieżka pliku do PUT, progress: fn(int $wysłane)
 */
function ghCall(string $method, string $url, ?string $token, $body = null, array $o = []): array {
    // w żądaniach z okna programu (api.php) nie czekamy: serwer PHP jest jednowątkowy i stanąłby cały program
    $noWait = !empty($GLOBALS['ghNoWait']);
    for ($try = 0; ; $try++) {
        $hdr = [];
        $headers = $o['headers'] ?? ['Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28'];
        $headers[] = 'User-Agent: CloudCut';
        $auth = $o['auth'] ?? 'bearer';
        if ($token !== null && $auth === 'bearer') $headers[] = 'Authorization: Bearer ' . $token;
        if ($token !== null && $auth === 'basic') $headers[] = 'Authorization: Basic ' . base64_encode('x-access-token:' . $token);
        $opt = [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 20, CURLOPT_LOW_SPEED_LIMIT => 256, CURLOPT_LOW_SPEED_TIME => 120,
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$hdr) {
                $p = strpos($line, ':');
                if ($p) $hdr[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
                return strlen($line);
            },
        ];
        $fh = null;
        if (isset($o['upload'])) {
            $fh = fopen($o['upload'], 'rb');
            $opt[CURLOPT_UPLOAD] = true;
            $opt[CURLOPT_INFILE] = $fh;
            $opt[CURLOPT_INFILESIZE] = filesize($o['upload']);
        } elseif ($body !== null) {
            $opt[CURLOPT_POSTFIELDS] = is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!array_filter($headers, fn($h) => stripos($h, 'content-type:') === 0)) $headers[] = 'Content-Type: application/json';
        }
        if (isset($o['progress'])) {
            $cb = $o['progress'];
            $opt[CURLOPT_NOPROGRESS] = false;
            $opt[CURLOPT_XFERINFOFUNCTION] = function ($ch, $dt, $dn, $ut, $un) use ($cb) { $cb((int) $un); return 0; };
        }
        $opt[CURLOPT_HTTPHEADER] = $headers;
        $c = curl_init($url);
        curl_setopt_array($c, $opt);
        $raw = curl_exec($c);
        $code = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        $err = curl_error($c);
        if ($fh) fclose($fh);
        if ($raw === false) {
            if ($try < 3 && !$noWait) { sleep(3 + 4 * $try); continue; }
            throw new GhError('Brak połączenia z GitHubem (' . $err . '). Sprawdź internet i spróbuj ponownie.');
        }
        $limited = ($code === 403 || $code === 429)
            && (isset($hdr['retry-after']) || ($hdr['x-ratelimit-remaining'] ?? '') === '0' || stripos((string) $raw, 'rate limit') !== false);
        if ($limited && $noWait) throw new GhError('GitHub chwilowo ogranicza liczbę zapytań — spróbuj ponownie za kilka minut.');
        if ($limited && $try < 6) {
            $wait = isset($hdr['retry-after']) ? (int) $hdr['retry-after'] : (isset($hdr['x-ratelimit-reset']) ? (int) $hdr['x-ratelimit-reset'] - time() : 60);
            $wait = max(5, min($wait, 900));
            ghNote("GitHub chwilowo ogranicza tempo — wznowienie za $wait s");
            sleep($wait);
            continue;
        }
        if ($code >= 500 && $try < 3 && !$noWait) { sleep(3 + 5 * $try); continue; }
        return ['code' => $code, 'json' => json_decode((string) $raw, true), 'headers' => $hdr, 'raw' => (string) $raw];
    }
}
function ghFail(array $r, string $what): never {
    $msg = (string) ($r['json']['message'] ?? '');
    throw new GhError(match (true) {
        $r['code'] === 401 => 'GitHub nie przyjął tokenu — jest błędny albo wygasł. Wklej nowy w Ustawieniach.',
        $r['code'] === 403 => "Token nie ma uprawnień do zapisu ($what). Utwórz token z zaznaczonym zakresem „repo”.",
        $r['code'] === 404 => "Nie znaleziono repozytorium albo token nie ma do niego dostępu ($what).",
        $r['code'] === 409 => "GitHub zgłosił konflikt ($what)" . ($msg ? ": $msg" : '') . '. Spróbuj ponownie.',
        default => "GitHub odpowiedział błędem {$r['code']} ($what)" . ($msg ? ": $msg" : ''),
    });
}

/* ---------------- Konto i repozytorium ---------------- */
function ghLogin(array $cfg, string $token, int $uid): string {
    if ($cfg['login']) return $cfg['login'];
    $u = ghCall('GET', ghApi() . '/user', $token);
    if ($u['code'] !== 200) ghFail($u, 'konto');
    ghSaveConfig($uid, ['login' => $u['json']['login']]);
    return $u['json']['login'];
}
function ghResolveRepo(array $cfg, string $token, int $uid): array {
    $repo = parseRepo((string) $cfg['repo']);
    if (!$repo) throw new GhError('Podaj w Ustawieniach link do repozytorium (np. https://github.com/twoja-nazwa/cloudcat-project001).');
    return [$repo[0] ?? ghLogin($cfg, $token, $uid), $repo[1]];
}
/* Prawo zapisu sprawdzamy tak jak git przy „push” — pole permissions w API kłamie dla tokenów z samym odczytem */
function ghCanPush(string $owner, string $name, string $token): ?bool {
    $r = ghCall('GET', ghWeb() . "/$owner/$name.git/info/refs?service=git-receive-pack", $token, null,
        ['headers' => ['Accept: */*'], 'auth' => 'basic']);
    if ($r['code'] === 200) return true;
    if (in_array($r['code'], [401, 403, 404], true)) return false;
    return null;
}
function ghCheck(int $uid): array {
    $cfg = ghConfig($uid);
    $token = ghToken($cfg);
    $u = ghCall('GET', ghApi() . '/user', $token);
    if ($u['code'] !== 200) ghFail($u, 'konto');
    $login = (string) $u['json']['login'];
    ghSaveConfig($uid, ['login' => $login]);
    $scopes = $u['headers']['x-oauth-scopes'] ?? null; // tylko klasyczne tokeny
    $out = [
        'login' => $login, 'name' => $u['json']['name'] ?? null, 'avatar' => $u['json']['avatar_url'] ?? null,
        'scopesOk' => $scopes === null || (bool) preg_match('/(^|,)\s*(repo|public_repo)\s*(,|$)/', $scopes),
        'repo' => null,
    ];
    $repo = parseRepo((string) $cfg['repo']);
    if (!$repo) return $out;
    $owner = $repo[0] ?? $login;
    if (!$repo[0]) ghSaveConfig($uid, ['repo' => "$owner/$repo[1]"]);
    $r = ghCall('GET', ghApi() . "/repos/$owner/$repo[1]", $token);
    if ($r['code'] === 404) {
        $out['repo'] = ['full' => "$owner/$repo[1]", 'exists' => false, 'canCreate' => strcasecmp($owner, $login) === 0];
        return $out;
    }
    if ($r['code'] !== 200) ghFail($r, 'repozytorium');
    $j = $r['json'];
    $out['repo'] = [
        'full' => $j['full_name'], 'exists' => true, 'private' => (bool) $j['private'], 'url' => $j['html_url'],
        'defaultBranch' => $j['default_branch'] ?? null, 'canPush' => ghCanPush($owner, $repo[1], $token),
    ];
    return $out;
}
function ghCreateRepo(int $uid): array {
    $cfg = ghConfig($uid);
    $token = ghToken($cfg);
    $login = ghLogin($cfg, $token, $uid);
    $repo = parseRepo((string) $cfg['repo']) ?? [null, 'cloudcat-project001'];
    $owner = $repo[0] ?? $login;
    $body = ['name' => $repo[1], 'private' => true, 'auto_init' => true, 'description' => 'Projekty z programu CloudCut'];
    $r = strcasecmp($owner, $login) === 0
        ? ghCall('POST', ghApi() . '/user/repos', $token, $body)
        : ghCall('POST', ghApi() . "/orgs/$owner/repos", $token, $body);
    if ($r['code'] === 422) throw new GhError('Repozytorium o tej nazwie już istnieje albo nazwa jest nieprawidłowa.');
    if ($r['code'] === 403 || $r['code'] === 404) throw new GhError('Token nie może zakładać repozytoriów. Załóż je ręcznie na GitHubie albo utwórz token z zakresem „repo”.');
    if ($r['code'] !== 201) ghFail($r, 'zakładanie repozytorium');
    ghSaveConfig($uid, ['repo' => $r['json']['full_name']]);
    return ['full' => $r['json']['full_name'], 'url' => $r['json']['html_url'], 'private' => (bool) $r['json']['private']];
}

/* ---------------- Stan wysyłki (plik czytany przez okno programu) ---------------- */
function ghStatusFile(int $uid): string { return DATA_DIR . "/github/$uid.json"; }
function ghStatus(int $uid): ?array {
    $f = ghStatusFile($uid);
    if (!is_file($f)) return null;
    $s = json_decode((string) @file_get_contents($f), true);
    if (!is_array($s)) { usleep(80_000); $s = json_decode((string) @file_get_contents($f), true); }
    if (!is_array($s)) return null;
    if (($s['state'] ?? '') === 'running' && time() - (int) ($s['at'] ?? 0) > GH_STALE) {
        $s['state'] = 'error';
        $s['error'] = 'Wysyłka się przerwała (program został zamknięty albo zerwało połączenie). Spróbuj ponownie — wyśle się tylko to, czego brakuje.';
    }
    return $s;
}
function ghWriteStatus(int $uid, array $s): void {
    $s['at'] = time();
    file_put_contents(ghStatusFile($uid), json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}
/* Wysyłka idzie w osobnym procesie, żeby program (jednowątkowy serwer PHP) działał w tym czasie normalnie */
function ghStartWorker(int $uid, array $ids): void {
    ghWriteStatus($uid, ['state' => 'running', 'step' => 'Przygotowanie…', 'pct' => 0, 'projects' => $ids, 'started' => time()]);
    file_put_contents(DATA_DIR . "/github/$uid.job.json", json_encode(['projects' => $ids]));
    $php = PHP_BINARY;
    if (PHP_OS_FAMILY === 'Windows') {
        $win = dirname($php) . DIRECTORY_SEPARATOR . 'php-win.exe'; // bez okna konsoli
        if (is_file($win)) $php = $win;
    }
    $cmd = [$php];
    if ($ini = php_ini_loaded_file()) array_push($cmd, '-c', $ini);
    array_push($cmd, '-d', 'memory_limit=1536M', '-d', 'max_execution_time=0', __DIR__ . '/github-push.php', (string) $uid);
    $log = DATA_DIR . "/github/$uid.log";
    $null = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    // katalog roboczy = folder PHP: wersja na komputer wczytuje moduły ścieżką względną „ext”
    $proc = proc_open($cmd, [0 => ['file', $null, 'r'], 1 => ['file', $log, 'w'], 2 => ['file', $log, 'a']], $pipes, dirname(PHP_BINARY), null,
        ['bypass_shell' => true, 'create_process_group' => true]);
    if (!is_resource($proc)) {
        ghWriteStatus($uid, ['state' => 'error', 'error' => 'Nie udało się uruchomić wysyłki.', 'projects' => $ids]);
        throw new GhError('Nie udało się uruchomić wysyłki.');
    }
    // nie czekamy na koniec — proces pracuje dalej sam i zapisuje postęp w pliku stanu
}

/* ---------------- Pliki do wysłania ---------------- */
function ghSlug(string $s, int $max = 40): string {
    $s = strtr(mb_strtolower($s), ['ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n', 'ó' => 'o', 'ś' => 's', 'ź' => 'z', 'ż' => 'z',
        'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss', 'é' => 'e', 'è' => 'e', 'á' => 'a', 'í' => 'i', 'ú' => 'u', 'č' => 'c', 'š' => 's', 'ž' => 'z', 'ř' => 'r', 'ý' => 'y']);
    $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', $s), '-');
    return rtrim(substr($s, 0, $max), '-') ?: 'bez-nazwy';
}
function ghExt(string $name, string $type): string {
    $e = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (preg_match('/^[a-z0-9]{1,8}$/', $e)) return $e;
    $t = strtolower(explode(';', explode('/', $type . '/')[1])[0]);
    return preg_match('/^[a-z0-9]{1,8}$/', $t) ? $t : 'bin';
}
function gitSha(string $content): string { return sha1('blob ' . strlen($content) . "\0" . $content); }
function ghFileHash(string $file, string $algo, array &$cache): string {
    clearstatcache(true, $file);
    $key = $algo . '|' . $file . '|' . filesize($file) . '|' . filemtime($file);
    if (isset($cache[$key])) return $cache[$key];
    if ($algo === 'git') {
        $h = hash_init('sha1');
        hash_update($h, 'blob ' . filesize($file) . "\0");
        hash_update_file($h, $file);
        $v = hash_final($h);
    } else {
        $v = hash_file('sha256', $file);
    }
    return $cache[$key] = $v;
}
function ghFmtDur(float $s): string {
    $s = (int) round($s);
    return $s >= 3600 ? sprintf('%d:%02d:%02d', intdiv($s, 3600), intdiv($s % 3600, 60), $s % 60) : sprintf('%d:%02d', intdiv($s, 60), $s % 60);
}
function ghReadme(array $index): string {
    $rows = $index['projects'];
    uasort($rows, fn($a, $b) => ($b['updated'] ?? 0) <=> ($a['updated'] ?? 0));
    $md = "# CloudCut — kopia projektów\n\n"
        . 'Zapisane programem CloudCut. Ostatni zapis: ' . date('d.m.Y, H:i', (int) ($index['savedAt'] ?? time())) . ".\n\n";
    if ($rows) {
        $md .= "| | Projekt | Długość | Ostatnia zmiana |\n|---|---|---|---|\n";
        foreach ($rows as $p) {
            $thumb = !empty($p['thumb']) ? '<img src="' . $p['folder'] . '/' . $p['thumb'] . '" width="120" alt="">' : '';
            $name = str_replace(['|', '[', ']'], ['\\|', '(', ')'], (string) $p['name']);
            $md .= "| $thumb | [$name]({$p['folder']}) | " . ghFmtDur((float) ($p['duration'] ?? 0)) . ' | '
                . date('d.m.Y H:i', (int) round(($p['updated'] ?? 0) / 1000)) . " |\n";
        }
    }
    return $md . "\nKażdy folder w `projekty/` zawiera `projekt.json` (montaż), `media/` (pliki wideo, audio i zdjęcia) i miniaturę.\n"
        . "Pliki od 50 MB są w Git LFS — pobierzesz je przyciskiem „Download” przy pliku na GitHubie albo poleceniem `git lfs pull`.\n";
}

/* ---------------- Wysyłka ---------------- */
function ghHead(string $base, string $token, string $branch, string $default): array {
    $r = ghCall('GET', "$base/git/ref/heads/$branch", $token);
    if ($r['code'] === 409) {
        // puste repozytorium — Git Data API potrzebuje choć jednego commita
        ghReport(['step' => 'Pierwszy zapis w pustym repozytorium…'], true);
        $i = ghCall('PUT', "$base/contents/README.md", $token, ['message' => 'CloudCut: początek kopii', 'content' => base64_encode("# CloudCut — kopia projektów\n"), 'branch' => $branch]);
        if ($i['code'] >= 300) ghFail($i, 'pierwszy zapis');
        $r = ghCall('GET', "$base/git/ref/heads/$branch", $token);
    } elseif ($r['code'] === 404) {
        // takiej gałęzi jeszcze nie ma — zakładamy ją od domyślnej
        $d = ghCall('GET', "$base/git/ref/heads/$default", $token);
        if ($d['code'] !== 200) ghFail($d, 'gałąź domyślna');
        $n = ghCall('POST', "$base/git/refs", $token, ['ref' => "refs/heads/$branch", 'sha' => $d['json']['object']['sha']]);
        if ($n['code'] !== 201) ghFail($n, 'nowa gałąź');
        $r = ['code' => 200, 'json' => $n['json']];
    }
    if ($r['code'] !== 200) ghFail($r, 'gałąź');
    $head = $r['json']['object']['sha'];
    $c = ghCall('GET', "$base/git/commits/$head", $token);
    if ($c['code'] !== 200) ghFail($c, 'ostatni commit');
    return [$head, $c['json']['tree']['sha']];
}
/* $onBytes(wpis, wysłane bajty) — postęp w trakcie; $onDone(wpis, czy wysłany) — raz na plik */
function ghLfsUpload(string $owner, string $name, string $token, string $branch, array $items, callable $onBytes, callable $onDone): void {
    $lfsHdr = ['Accept: application/vnd.git-lfs+json', 'Content-Type: application/vnd.git-lfs+json'];
    $byOid = [];
    foreach ($items as $e) $byOid[$e['lfs']['oid']] = $e;
    foreach (array_chunk(array_values($items), 100) as $chunk) {
        $r = ghCall('POST', ghWeb() . "/$owner/$name.git/info/lfs/objects/batch", $token, [
            'operation' => 'upload', 'transfers' => ['basic'], 'ref' => ['name' => "refs/heads/$branch"], 'hash_algo' => 'sha256',
            'objects' => array_map(fn($e) => ['oid' => $e['lfs']['oid'], 'size' => $e['lfs']['size']], $chunk),
        ], ['headers' => $lfsHdr, 'auth' => 'basic']);
        if ($r['code'] !== 200) ghFail($r, 'Git LFS — duże pliki');
        foreach ($r['json']['objects'] ?? [] as $o) {
            $e = $byOid[$o['oid']] ?? null;
            if (!$e) continue;
            if (isset($o['error'])) throw new GhError("GitHub nie przyjął dużego pliku „{$e['label']}”: " . ($o['error']['message'] ?? 'błąd LFS')
                . '. Sprawdź limit miejsca na Git LFS w ustawieniach konta GitHub.');
            $up = $o['actions']['upload'] ?? null;
            if (!$up) { $onDone($e, false); continue; } // już leży na GitHubie
            $h = ['Content-Type: application/octet-stream'];
            foreach ($up['header'] ?? [] as $k => $v) $h[] = "$k: $v";
            $res = ghCall('PUT', $up['href'], null, null, ['headers' => $h, 'auth' => 'none', 'upload' => $e['file'],
                'progress' => fn(int $sent) => $onBytes($e, $sent)]);
            if ($res['code'] >= 300) throw new GhError("Nie udało się wysłać dużego pliku „{$e['label']}” (błąd {$res['code']}).");
            if ($v = $o['actions']['verify'] ?? null) {
                $vh = $lfsHdr;
                foreach ($v['header'] ?? [] as $k => $val) $vh[] = "$k: $val";
                $vr = ghCall('POST', $v['href'], null, ['oid' => $o['oid'], 'size' => $e['lfs']['size']], ['headers' => $vh, 'auth' => 'none']);
                if ($vr['code'] >= 300) throw new GhError("GitHub nie potwierdził dużego pliku „{$e['label']}” (błąd {$vr['code']}).");
            }
            $onDone($e, true);
        }
    }
}

function ghPushProjects(int $uid, array $ids, bool $retry = true): array {
    $cfg = ghConfig($uid);
    $token = ghToken($cfg);
    [$owner, $name] = ghResolveRepo($cfg, $token, $uid);
    $base = ghApi() . "/repos/$owner/$name";
    ghReport(['step' => 'Łączenie z GitHubem…', 'pct' => 1], true);
    $info = ghCall('GET', $base, $token);
    if ($info['code'] !== 200) ghFail($info, "repozytorium $owner/$name");
    $default = (string) ($info['json']['default_branch'] ?? 'main');
    $branch = $cfg['branch'] ?: $default;
    [$head, $baseTree] = ghHead($base, $token, $branch, $default);
    $t = ghCall('GET', "$base/git/trees/$baseTree?recursive=1", $token);
    if ($t['code'] !== 200) ghFail($t, 'zawartość repozytorium');
    $remote = [];
    foreach ($t['json']['tree'] ?? [] as $e) if (($e['type'] ?? '') === 'blob') $remote[$e['path']] = $e['sha'];
    $known = array_flip(array_values($remote));

    // projekty z bazy
    if (!$ids) throw new GhError('Nie zaznaczono żadnego projektu.');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $q = db()->prepare("SELECT * FROM projects WHERE user_id = ? AND deleted IS NULL AND id IN ($in)");
    $q->execute([$uid, ...$ids]);
    $projects = $q->fetchAll();
    if (!$projects) throw new GhError('Zaznaczonych projektów nie ma już na koncie.');

    $entries = [];   // ścieżka => wpis
    $skipped = [];
    $index = ['app' => 'CloudCut', 'format' => 1, 'savedAt' => time(), 'projects' => []];
    if (isset($remote['cloudcut.json'])) {
        $old = ghCall('GET', "$base/git/blobs/{$remote['cloudcut.json']}", $token);
        $prev = $old['code'] === 200 ? json_decode((string) base64_decode((string) ($old['json']['content'] ?? '')), true) : null;
        if (is_array($prev['projects'] ?? null)) $index['projects'] = $prev['projects'];
    }
    $cacheFile = DATA_DIR . "/github/$uid.hashes.json";
    $cache = json_decode((string) @file_get_contents($cacheFile), true) ?: [];
    $addText = function (string $path, string $content) use (&$entries) {
        $entries[$path] = ['path' => $path, 'content' => $content, 'sha' => gitSha($content), 'size' => strlen($content), 'label' => basename($path)];
    };
    $pushedDirs = [];
    $nProj = count($projects);
    foreach ($projects as $pi => $p) {
        ghReport(['step' => "Przygotowanie projektu „{$p['name']}” (" . ($pi + 1) . "/$nProj)…", 'pct' => 2 + (int) (8 * $pi / $nProj)], true);
        $dir = 'projekty/' . ghSlug($p['name']) . '-' . $p['id'];
        $pushedDirs[$p['id']] = $dir;
        $mids = json_decode($p['media_ids'], true) ?: [];
        $media = [];
        $attrs = [];
        if ($mids) {
            $mq = db()->prepare('SELECT * FROM media WHERE user_id = ? AND id IN (' . implode(',', array_fill(0, count($mids), '?')) . ')');
            $mq->execute([$uid, ...$mids]);
            foreach ($mq->fetchAll() as $m) {
                $meta = json_decode($m['meta'], true) ?: [];
                $label = (string) ($meta['name'] ?? $m['id']);
                $file = DATA_DIR . "/media/$uid/{$m['id']}.bin";
                $rel = 'media/' . ghSlug(pathinfo($label, PATHINFO_FILENAME), 50) . '-' . $m['id'] . '.' . ghExt($label, (string) $m['type']);
                $item = ['id' => $m['id'], 'name' => $label, 'type' => $m['type'], 'size' => (int) $m['size'], 'meta' => $meta, 'file' => null];
                if (!$m['has_file'] || !is_file($file)) { $skipped[] = "$label (brak pliku na dysku)"; $media[] = $item; continue; }
                $size = filesize($file);
                if ($size > GH_LFS_MAX) { $skipped[] = "$label (ponad 2 GB — limit GitHuba)"; $media[] = $item; continue; }
                $item['file'] = $rel;
                $path = "$dir/$rel";
                if ($size >= GH_LFS_FROM) {
                    ghReport(['step' => "Liczenie sumy kontrolnej: $label…"], true);
                    $oid = ghFileHash($file, 'sha256', $cache);
                    $pointer = "version https://git-lfs.github.com/spec/v1\noid sha256:$oid\nsize $size\n";
                    $entries[$path] = ['path' => $path, 'content' => $pointer, 'sha' => gitSha($pointer), 'size' => $size, 'label' => $label,
                        'lfs' => ['oid' => $oid, 'size' => $size], 'file' => $file];
                    $attrs[] = str_replace(' ', '[[:space:]]', $rel) . ' filter=lfs diff=lfs merge=lfs -text';
                    $item['lfs'] = true;
                } else {
                    $entries[$path] = ['path' => $path, 'file' => $file, 'sha' => ghFileHash($file, 'git', $cache), 'size' => $size, 'label' => $label];
                }
                $media[] = $item;
            }
        }
        $thumb = null;
        if ($p['thumb'] && preg_match('#^data:image/(jpeg|png|webp);base64,(.+)$#', (string) $p['thumb'], $tm)) {
            $bin = base64_decode($tm[2], true);
            if ($bin !== false) {
                $thumb = 'miniatura.' . ($tm[1] === 'jpeg' ? 'jpg' : $tm[1]);
                $entries["$dir/$thumb"] = ['path' => "$dir/$thumb", 'binary' => $bin, 'sha' => gitSha($bin), 'size' => strlen($bin), 'label' => $thumb];
            }
        }
        $addText("$dir/projekt.json", json_encode([
            'cloudcut' => 1, 'id' => $p['id'], 'name' => $p['name'], 'updated' => (int) $p['updated'], 'duration' => (float) $p['duration'],
            'media' => $media, 'project' => json_decode($p['data'], true),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
        if ($attrs) $addText("$dir/.gitattributes", implode("\n", $attrs) . "\n");
        $index['projects'][$p['id']] = ['name' => $p['name'], 'folder' => $dir, 'thumb' => $thumb, 'updated' => (int) $p['updated'],
            'duration' => (float) $p['duration'], 'saved' => time()];
    }
    @file_put_contents($cacheFile, json_encode($cache));

    // spis i README: wypadają projekty, których folderów już nie ma w repozytorium
    $folders = [];
    foreach (array_keys($remote) as $path) if (preg_match('#^(projekty/[^/]+)/#', $path, $fm)) $folders[$fm[1]] = true;
    foreach ($pushedDirs as $d) $folders[$d] = true;
    $index['projects'] = array_filter($index['projects'], fn($p) => is_array($p) && isset($folders[$p['folder'] ?? '']));
    $addText('cloudcut.json', json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    $addText('README.md', ghReadme($index));

    // co się zmieniło: nowe i inne pliki + pliki wysyłanych projektów, których już nie ma (także po zmianie nazwy projektu)
    $changed = array_filter($entries, fn($e) => ($remote[$e['path']] ?? null) !== $e['sha']);
    $deletes = [];
    foreach (array_keys($remote) as $path) {
        if (isset($entries[$path]) || !preg_match('#^projekty/[^/]*-([a-z0-9]{4,48})/#i', $path, $dm)) continue;
        if (isset($pushedDirs[$dm[1]])) $deletes[] = $path;
    }
    $onlyMeta = !array_diff_key($changed, ['cloudcut.json' => 1, 'README.md' => 1]);
    if ((!$changed || $onlyMeta) && !$deletes) {
        ghSaveConfig($uid, ['last_push' => time(), 'last_url' => ghWeb() . "/$owner/$name/tree/$branch"]);
        ghMarkPushed($uid, $projects);
        return ['unchanged' => true, 'url' => ghWeb() . "/$owner/$name/tree/$branch", 'repo' => "$owner/$name", 'projects' => count($projects),
            'files' => 0, 'bytes' => 0, 'skipped' => $skipped];
    }

    // wysyłka: duże pliki przez LFS, reszta jako bloby (tekst do GH_INLINE_MAX od razu w drzewie)
    $toSend = array_filter($changed, fn($e) => !isset($known[$e['sha']]) && (isset($e['file']) || isset($e['binary']) || $e['size'] > GH_INLINE_MAX));
    $total = max(1, array_sum(array_map(fn($e) => $e['size'], $toSend)));
    $doneBytes = 0;
    $sentFiles = 0;
    $count = count($toSend);
    $progress = function (array $e, int $sent) use (&$doneBytes, $total, &$sentFiles, $count) {
        ghReport(['step' => "Wysyłanie: {$e['label']} (" . min($sentFiles + 1, $count) . "/$count)",
            'pct' => 10 + (int) (85 * min(1, ($doneBytes + min($sent, $e['size'])) / $total)), 'bytes' => $doneBytes + min($sent, $e['size']), 'total' => $total]);
    };
    $lfs = array_filter($toSend, fn($e) => isset($e['lfs']));
    if ($lfs) {
        ghLfsUpload($owner, $name, $token, $branch, $lfs, $progress, function (array $e, bool $uploaded) use (&$doneBytes, &$sentFiles) {
            $doneBytes += $e['size'];
            if ($uploaded) $sentFiles++;
        });
    }
    $tree = [];
    foreach ($changed as $path => $e) {
        if (isset($e['lfs']) || (!isset($e['file']) && !isset($e['binary']) && $e['size'] <= GH_INLINE_MAX && !isset($known[$e['sha']]))) {
            if (isset($known[$e['sha']])) { $tree[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => $e['sha']]; continue; }
            $tree[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'content' => $e['content']];
            continue;
        }
        if (!isset($known[$e['sha']])) {
            $bytes = isset($e['file']) ? (string) file_get_contents($e['file']) : ($e['binary'] ?? $e['content']);
            $b = ghCall('POST', "$base/git/blobs", $token, '{"encoding":"base64","content":"' . base64_encode($bytes) . '"}',
                ['progress' => fn(int $sent) => $progress($e, (int) ($sent * 0.75))]);
            unset($bytes);
            if ($b['code'] !== 201) ghFail($b, "plik {$e['label']}");
            if (($b['json']['sha'] ?? '') !== $e['sha']) throw new GhError("Suma kontrolna pliku „{$e['label']}” nie zgadza się z tym, co przyjął GitHub.");
            $known[$e['sha']] = true;
            $doneBytes += $e['size'];
            $sentFiles++;
        }
        $tree[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => $e['sha']];
    }
    foreach ($deletes as $path) $tree[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => null];

    ghReport(['step' => 'Zapisywanie zmian (commit)…', 'pct' => 96], true);
    $nt = ghCall('POST', "$base/git/trees", $token, ['base_tree' => $baseTree, 'tree' => $tree]);
    if ($nt['code'] !== 201) ghFail($nt, 'drzewo plików');
    $names = array_map(fn($p) => $p['name'], $projects);
    $msg = 'CloudCut: ' . implode(', ', array_slice($names, 0, 3)) . (count($names) > 3 ? ' i ' . (count($names) - 3) . ' innych' : '');
    $cm = ghCall('POST', "$base/git/commits", $token, ['message' => $msg, 'tree' => $nt['json']['sha'], 'parents' => [$head]]);
    if ($cm['code'] !== 201) ghFail($cm, 'commit');
    $up = ghCall('PATCH', "$base/git/refs/heads/$branch", $token, ['sha' => $cm['json']['sha'], 'force' => false]);
    if ($up['code'] === 422 && $retry) return ghPushProjects($uid, $ids, false); // ktoś zapisał w międzyczasie — jeszcze raz od nowego stanu
    if ($up['code'] !== 200) ghFail($up, 'przesunięcie gałęzi');
    $url = ghWeb() . "/$owner/$name/commit/{$cm['json']['sha']}";
    ghSaveConfig($uid, ['last_push' => time(), 'last_url' => $url]);
    ghMarkPushed($uid, $projects);
    return ['unchanged' => false, 'url' => $url, 'repo' => "$owner/$name", 'repoUrl' => ghWeb() . "/$owner/$name", 'projects' => count($projects),
        'files' => $sentFiles, 'bytes' => $doneBytes, 'skipped' => $skipped];
}
