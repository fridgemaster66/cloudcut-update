<?php
declare(strict_types=1);
/*
 * CloudCut — aktualizacje programu z repozytorium GitHub.
 *
 * Sprawdzenie porównuje sumy gita plików programu na dysku z plikami w repozytorium (jedno drzewo z API),
 * więc wykrywa każdą zmianę pliku bez pamiętania „wersji bazowej”. Program w repozytorium może leżeć
 * w podfolderze — rozpoznajemy go po index.html i router.php obok siebie.
 * Instalacja podmienia tylko pliki programu z listy UPD_FILES (nigdy server/config.php ani danych)
 * i wcześniej odkłada ich obecne wersje do data/updates/backup, żeby dało się wrócić.
 * Pliki podmienia tylko wersja na komputer (CLOUDCUT_DESKTOP=1 albo plik .cloudcut-desktop) — w wersji z przeglądarki to kod źródłowy.
 */
require_once __DIR__ . '/github.php';

const UPD_FILES = '#^(index\.html|style\.css|router\.php|js/[A-Za-z0-9._-]+\.js|vendor/[A-Za-z0-9._-]+\.(?:m?js|css|wasm)|server/(?!config\.php$)[A-Za-z0-9._-]+\.php)$#';

function updDir(): string {
    $d = DATA_DIR . '/updates';
    if (!is_dir($d)) mkdir($d, 0770, true);
    return $d;
}
function updAppDir(): string { return realpath(__DIR__ . '/..'); }
// wersja na komputer: zmienna od main.js albo znacznik, który prepare-runtime.mjs kładzie obok plików programu
function updCanApply(): bool { return getenv('CLOUDCUT_DESKTOP') === '1' || is_file(updAppDir() . '/.cloudcut-desktop'); }
function updConfig(): array {
    $c = json_decode((string) @file_get_contents(updDir() . '/config.json'), true);
    return (is_array($c) ? $c : []) + ['repo' => '', 'branch' => '', 'auto' => true, 'installed' => null, 'backup' => null, 'lastCheck' => null];
}
function updSave(array $set): array {
    $c = array_merge(updConfig(), $set);
    file_put_contents(updDir() . '/config.json', json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
    return $c;
}
function updPublic(): array {
    $c = updConfig();
    $r = parseRepo((string) $c['repo']);
    return [
        'repo' => $c['repo'], 'branch' => $c['branch'], 'auto' => (bool) $c['auto'],
        'repoUrl' => $r && $r[0] ? ghWeb() . "/$r[0]/$r[1]" : null,
        'installed' => $c['installed'], 'lastCheck' => $c['lastCheck'],
        'backup' => $c['backup'] ? ['at' => $c['backup']['at'], 'files' => count($c['backup']['files'])] : null,
        'canApply' => updCanApply(),
    ];
}
/* Token z sekcji GitHub (jeśli jest) — potrzebny tylko do prywatnego repozytorium */
function updToken(int $uid): ?string {
    $g = ghConfig($uid);
    return $g['token'] ? openToken($g['token']) : null;
}

/* Najnowszy commit i lista plików programu w repozytorium: ścieżka względem programu => suma gita */
function updRemote(int $uid): array {
    $c = updConfig();
    $repo = parseRepo((string) $c['repo']);
    if (!$repo) throw new GhError('Podaj w Ustawieniach link do repozytorium z aktualizacjami.');
    if (!$repo[0]) throw new GhError('Podaj pełny link do repozytorium, np. https://github.com/twoja-nazwa/cloudcut.');
    [$owner, $name] = $repo;
    $token = updToken($uid);
    $base = ghApi() . "/repos/$owner/$name";
    $info = ghCall('GET', $base, $token);
    if ($info['code'] === 404) throw new GhError("Nie widzę repozytorium $owner/$name. Jeśli jest prywatne, połącz konto GitHub w sekcji wyżej.");
    if ($info['code'] !== 200) ghFail($info, 'repozytorium aktualizacji');
    $branch = $c['branch'] ?: (string) ($info['json']['default_branch'] ?? 'main');
    $cm = ghCall('GET', "$base/commits/" . $branch, $token);
    if ($cm['code'] === 409) throw new GhError('Repozytorium z aktualizacjami jest puste.');
    if ($cm['code'] !== 200) ghFail($cm, "gałąź $branch");
    $tree = ghCall('GET', "$base/git/trees/{$cm['json']['commit']['tree']['sha']}?recursive=1", $token);
    if ($tree['code'] !== 200) ghFail($tree, 'pliki repozytorium');
    $all = [];
    foreach ($tree['json']['tree'] ?? [] as $e) if (($e['type'] ?? '') === 'blob') $all[$e['path']] = $e['sha'];
    // folder programu w repozytorium: najkrótsza ścieżka, w której są obok siebie index.html i router.php
    $prefix = null;
    foreach (array_keys($all) as $p) {
        if (basename($p) !== 'router.php') continue;
        $dir = dirname($p) === '.' ? '' : dirname($p) . '/';
        if (isset($all[$dir . 'index.html']) && ($prefix === null || strlen($dir) < strlen($prefix))) $prefix = $dir;
    }
    if ($prefix === null) throw new GhError("W repozytorium $owner/$name nie ma plików CloudCut (index.html i router.php).");
    $files = [];
    foreach ($all as $p => $sha) {
        if ($prefix !== '' && !str_starts_with($p, $prefix)) continue;
        $rel = substr($p, strlen($prefix));
        if (preg_match(UPD_FILES, $rel)) $files[$rel] = $sha;
    }
    return [
        'owner' => $owner, 'name' => $name, 'branch' => $branch, 'token' => $token, 'files' => $files, 'prefix' => $prefix,
        'sha' => $cm['json']['sha'], 'message' => trim((string) ($cm['json']['commit']['message'] ?? '')),
        'date' => (string) ($cm['json']['commit']['author']['date'] ?? $cm['json']['commit']['committer']['date'] ?? ''),
        'url' => (string) ($cm['json']['html_url'] ?? ghWeb() . "/$owner/$name/commit/{$cm['json']['sha']}"),
    ];
}
function updLocalSha(string $rel): ?string {
    $f = updAppDir() . '/' . $rel;
    if (!is_file($f)) return null;
    return gitSha((string) file_get_contents($f));
}
function updCheck(int $uid): array {
    $r = updRemote($uid);
    $changed = [];
    foreach ($r['files'] as $rel => $sha) {
        $local = updLocalSha($rel);
        if ($local !== $sha) $changed[] = ['path' => $rel, 'sha' => $sha, 'new' => $local === null];
    }
    $out = [
        'available' => (bool) $changed, 'sha' => $r['sha'], 'message' => $r['message'], 'date' => $r['date'], 'url' => $r['url'],
        'repo' => "{$r['owner']}/{$r['name']}", 'branch' => $r['branch'], 'files' => $changed, 'canApply' => updCanApply(),
    ];
    updSave(['lastCheck' => ['at' => time(), 'sha' => $r['sha'], 'changes' => count($changed)]]);
    return $out;
}
function updApply(int $uid): array {
    if (!updCanApply()) throw new GhError('Aktualizacje instaluje wersja programu na komputer (CloudCut.exe). Tutaj pliki programu to kod źródłowy.');
    $r = updRemote($uid);
    $base = ghApi() . "/repos/{$r['owner']}/{$r['name']}";
    $app = updAppDir();
    // 1) pobranie i sprawdzenie wszystkich zmienionych plików, zanim cokolwiek nadpiszemy
    $incoming = [];
    foreach ($r['files'] as $rel => $sha) {
        if (updLocalSha($rel) === $sha) continue;
        $b = ghCall('GET', "$base/git/blobs/$sha", $r['token']);
        if ($b['code'] !== 200) ghFail($b, "plik $rel");
        $bytes = base64_decode(str_replace("\n", '', (string) ($b['json']['content'] ?? '')), true);
        if ($bytes === false || gitSha($bytes) !== $sha) throw new GhError("Plik $rel pobrał się uszkodzony — spróbuj ponownie.");
        $incoming[$rel] = $bytes;
    }
    if (!$incoming) return ['files' => 0, 'sha' => $r['sha']];
    // 2) kopia obecnych plików (poprzednia kopia zostaje zastąpiona)
    $bk = updDir() . '/backup';
    if (is_dir($bk)) updRemoveDir($bk);
    mkdir($bk, 0770, true);
    $saved = [];
    foreach (array_keys($incoming) as $rel) {
        $src = "$app/$rel";
        if (is_file($src)) {
            if (!is_dir(dirname("$bk/$rel"))) mkdir(dirname("$bk/$rel"), 0770, true);
            copy($src, "$bk/$rel");
            $saved[] = ['path' => $rel, 'existed' => true];
        } else {
            $saved[] = ['path' => $rel, 'existed' => false];
        }
    }
    $prev = updConfig()['installed'];
    updSave(['backup' => ['at' => time(), 'files' => $saved, 'installed' => $prev]]);
    // 3) podmiana; przy błędzie wracamy do kopii
    try {
        foreach ($incoming as $rel => $bytes) {
            $dst = "$app/$rel";
            if (!is_dir(dirname($dst))) mkdir(dirname($dst), 0775, true);
            if (file_put_contents($dst, $bytes, LOCK_EX) !== strlen($bytes)) throw new GhError("Nie udało się zapisać pliku $rel.");
        }
    } catch (Throwable $e) {
        updRollback();
        throw $e instanceof GhError ? $e : new GhError('Instalacja aktualizacji nie powiodła się — przywrócono poprzednie pliki.');
    }
    updSave(['installed' => ['sha' => $r['sha'], 'at' => time(), 'message' => $r['message'], 'repo' => "{$r['owner']}/{$r['name']}"]]);
    return ['files' => count($incoming), 'sha' => $r['sha']];
}
function updRollback(): array {
    $c = updConfig();
    if (!$c['backup']) throw new GhError('Nie ma kopii poprzedniej wersji.');
    $app = updAppDir();
    $bk = updDir() . '/backup';
    foreach ($c['backup']['files'] as $f) {
        $rel = (string) $f['path'];
        if (!preg_match(UPD_FILES, $rel)) continue;
        if ($f['existed']) copy("$bk/$rel", "$app/$rel");
        elseif (is_file("$app/$rel")) unlink("$app/$rel");
    }
    updRemoveDir($bk);
    updSave(['installed' => $c['backup']['installed'] ?? null, 'backup' => null]);
    return ['files' => count($c['backup']['files'])];
}
function updRemoveDir(string $dir): void {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
    }
    rmdir($dir);
}
