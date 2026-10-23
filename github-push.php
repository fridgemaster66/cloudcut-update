<?php
declare(strict_types=1);
/*
 * Osobny proces wysyłki „Zapisz na GitHub”. Uruchamia go api.php (ghStartWorker), a postęp zapisuje
 * w data/github/<id użytkownika>.json — okno programu odpytuje go przez GET /api/github/status.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib.php';
require __DIR__ . '/github.php';

$uid = (int) ($argv[1] ?? 0);
if ($uid <= 0) exit(1);
ensureDirs();
$lock = fopen(DATA_DIR . "/github/$uid.lock", 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit(0); // inna wysyłka tego konta już trwa

$job = json_decode((string) @file_get_contents(DATA_DIR . "/github/$uid.job.json"), true) ?: [];
$ids = array_values(array_filter((array) ($job['projects'] ?? []), fn($i) => is_string($i) && preg_match(ID_RE, $i)));
$status = ['state' => 'running', 'projects' => $ids, 'started' => time(), 'step' => 'Łączenie z GitHubem…', 'pct' => 0];
$GLOBALS['ghProgress'] = function (array $p) use ($uid, &$status) {
    $status = array_merge($status, $p);
    ghWriteStatus($uid, $status);
};
try {
    $res = ghPushProjects($uid, $ids);
    unset($status['note']);
    ghWriteStatus($uid, array_merge($status, ['state' => 'done', 'pct' => 100, 'step' => 'Gotowe', 'result' => $res, 'finished' => time()]));
} catch (Throwable $e) {
    error_log('CloudCut GitHub: ' . $e);
    ghWriteStatus($uid, array_merge($status, ['state' => 'error', 'finished' => time(),
        'error' => $e instanceof GhError ? $e->getMessage() : 'Nieoczekiwany błąd wysyłki: ' . $e->getMessage()]));
}
