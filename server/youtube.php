<?php
declare(strict_types=1);
/*
 * Połączenie z YouTube (OAuth 2.0 dla aplikacji na komputer, PKCE) i krótkie klucze do wysyłania filmów.
 * Klucz klienta (Client ID + secret) zakłada użytkownik w Google Cloud — każdy ma swój projekt API.
 * Powrót z logowania Google trafia do przeglądarki systemowej bez ciasteczka programu, więc użytkownika
 * rozpoznajemy po jednorazowym „state”. Klucz odświeżania leży zaszyfrowany (jak token GitHuba).
 * Sam film wysyła okno programu prosto do Google (wysyłka wznawialna) — PHP-a nie blokuje.
 */
require_once __DIR__ . '/github.php'; // sealToken / openToken

class YtError extends RuntimeException {}

function ytBase(): string { return rtrim((string) getenv('CLOUDCUT_GOOGLE_BASE'), '/'); } // atrapa Google w testach
function ytUrl(string $what): string {
    $b = ytBase();
    if ($b !== '') return $b . ['auth' => '/o/oauth2/v2/auth', 'token' => '/token', 'revoke' => '/revoke', 'api' => '/youtube/v3', 'upload' => '/upload/youtube/v3'][$what];
    return ['auth' => 'https://accounts.google.com/o/oauth2/v2/auth', 'token' => 'https://oauth2.googleapis.com/token', 'revoke' => 'https://oauth2.googleapis.com/revoke',
        'api' => 'https://www.googleapis.com/youtube/v3', 'upload' => 'https://www.googleapis.com/upload/youtube/v3'][$what];
}
const YT_SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

function ytDir(): string {
    $d = DATA_DIR . '/youtube';
    if (!is_dir($d)) mkdir($d, 0770, true);
    return $d;
}
function ytConfig(int $uid): array {
    $c = json_decode((string) @file_get_contents(ytDir() . "/$uid.json"), true);
    return is_array($c) ? $c : [];
}
function ytSave(int $uid, array $c): void {
    file_put_contents(ytDir() . "/$uid.json", json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}
function ytRedirect(): string {
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '127.0.0.1');
    if (!preg_match('/^(127\.0\.0\.1|localhost)(:\d+)?$/', $host)) $host = '127.0.0.1:' . ($_SERVER['SERVER_PORT'] ?? '80');
    return "http://$host/api/youtube/callback";
}
function ytPublic(int $uid): array {
    $c = ytConfig($uid);
    $id = (string) ($c['clientId'] ?? '');
    return [
        'configured' => $id !== '' && !empty($c['clientSecret']),
        'clientId' => $id === '' ? null : $id,
        'connected' => !empty($c['refresh']),
        'channel' => $c['channel'] ?? null,
        'redirectUri' => ytRedirect(),
        'uploadBase' => ytUrl('upload'),
    ];
}

function ytCall(string $method, string $url, array $headers = [], ?string $body = null): array {
    $c = curl_init($url);
    $hdr = [];
    curl_setopt_array($c, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 40,
        CURLOPT_HTTPHEADER => array_merge(['User-Agent: CloudCut'], $headers),
        CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$hdr) { $p = strpos($line, ':'); if ($p) $hdr[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1)); return strlen($line); },
    ]);
    if ($body !== null) curl_setopt($c, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($c);
    $code = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    $err = curl_error($c);
    curl_close($c);
    if ($raw === false) throw new YtError('Brak połączenia z Google: ' . $err);
    return ['code' => $code, 'json' => json_decode((string) $raw, true), 'raw' => (string) $raw, 'headers' => $hdr];
}
function ytGoogleError(array $r, string $what): string {
    $j = $r['json'] ?? [];
    $msg = $j['error_description'] ?? ($j['error']['message'] ?? (is_string($j['error'] ?? null) ? $j['error'] : ''));
    if (($j['error'] ?? '') === 'invalid_client') return 'Google nie zna tego klucza klienta — sprawdź Client ID i Client secret w Ustawieniach.';
    if (($j['error'] ?? '') === 'invalid_grant') return 'Google unieważnił połączenie (np. odebrano dostęp albo minął tydzień w trybie testowym) — połącz YouTube ponownie.';
    return "Google odrzucił $what (błąd {$r['code']})" . ($msg ? ": $msg" : '.');
}

/* Logowanie: adres strony zgody Google z jednorazowym state i weryfikatorem PKCE */
function ytConnectUrl(int $uid): string {
    $c = ytConfig($uid);
    if (empty($c['clientId']) || empty($c['clientSecret'])) throw new YtError('Najpierw wklej Client ID i Client secret z Google Cloud.');
    foreach (glob(ytDir() . '/state-*.json') ?: [] as $f) if (filemtime($f) < time() - 900) @unlink($f); // stare próby logowania
    $state = bin2hex(random_bytes(16));
    $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    file_put_contents(ytDir() . "/state-$state.json", json_encode(['uid' => $uid, 'verifier' => $verifier, 'redirect' => ytRedirect(), 'at' => time()]), LOCK_EX);
    $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    return ytUrl('auth') . '?' . http_build_query([
        'client_id' => $c['clientId'], 'redirect_uri' => ytRedirect(), 'response_type' => 'code', 'scope' => YT_SCOPES,
        'access_type' => 'offline', 'prompt' => 'consent', 'state' => $state, 'code_challenge' => $challenge, 'code_challenge_method' => 'S256',
        'include_granted_scopes' => 'true',
    ]);
}
/* Powrót z Google: wymiana kodu na klucze, nazwa kanału — zwraca tekst strony dla przeglądarki */
function ytCallback(string $state, string $code, string $error): array {
    if (!preg_match('/^[a-f0-9]{32}$/', $state)) return [false, 'Nieprawidłowy powrót z logowania Google.'];
    $f = ytDir() . "/state-$state.json";
    $s = json_decode((string) @file_get_contents($f), true);
    @unlink($f); // jednorazowy
    if (!is_array($s) || time() - (int) $s['at'] > 900) return [false, 'Logowanie wygasło — kliknij „Połącz z YouTube” w CloudCut jeszcze raz.'];
    if ($error !== '') return [false, $error === 'access_denied' ? 'Nie zgodzono się na dostęp — kanał nie został połączony.' : "Google zwrócił błąd: $error"];
    $uid = (int) $s['uid'];
    $c = ytConfig($uid);
    $r = ytCall('POST', ytUrl('token'), ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
        'client_id' => $c['clientId'] ?? '', 'client_secret' => openToken($c['clientSecret'] ?? null) ?? '', 'code' => $code,
        'code_verifier' => $s['verifier'], 'grant_type' => 'authorization_code', 'redirect_uri' => $s['redirect'],
    ]));
    if ($r['code'] !== 200 || empty($r['json']['access_token'])) return [false, ytGoogleError($r, 'logowanie')];
    $j = $r['json'];
    if (!empty($j['refresh_token'])) $c['refresh'] = sealToken($j['refresh_token']);
    if (empty($c['refresh'])) return [false, 'Google nie dał klucza odświeżania — odłącz CloudCut na myaccount.google.com/permissions i połącz ponownie.'];
    $c['access'] = sealToken($j['access_token']);
    $c['accessExp'] = time() + (int) ($j['expires_in'] ?? 3600) - 60;
    $c['connectedAt'] = time();
    $c['channel'] = ytChannel($j['access_token']);
    ytSave($uid, $c);
    $name = $c['channel']['title'] ?? 'Twój kanał';
    return [true, "Połączono z kanałem „{$name}”. Możesz zamknąć tę kartę i wrócić do CloudCut."];
}
function ytChannel(string $access): ?array {
    try {
        $r = ytCall('GET', ytUrl('api') . '/channels?part=snippet&mine=true', ['Authorization: Bearer ' . $access]);
        $it = $r['json']['items'][0] ?? null;
        if (!$it) return null;
        return ['id' => (string) $it['id'], 'title' => (string) ($it['snippet']['title'] ?? ''), 'thumb' => (string) ($it['snippet']['thumbnails']['default']['url'] ?? '')];
    } catch (YtError) { return null; }
}
/* Krótki klucz (ok. godziny) do wysyłki z okna programu — odświeżany kluczem z pliku */
function ytAccessToken(int $uid): array {
    $c = ytConfig($uid);
    if (empty($c['refresh'])) throw new YtError('YouTube nie jest połączony — połącz go w Ustawieniach.');
    if (!empty($c['access']) && (int) ($c['accessExp'] ?? 0) > time() + 120) return ['accessToken' => openToken($c['access']), 'expiresAt' => (int) $c['accessExp']];
    $r = ytCall('POST', ytUrl('token'), ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
        'client_id' => $c['clientId'] ?? '', 'client_secret' => openToken($c['clientSecret'] ?? null) ?? '',
        'refresh_token' => openToken($c['refresh']), 'grant_type' => 'refresh_token',
    ]));
    if ($r['code'] !== 200 || empty($r['json']['access_token'])) {
        if (($r['json']['error'] ?? '') === 'invalid_grant') { unset($c['refresh'], $c['access']); ytSave($uid, $c); }
        throw new YtError(ytGoogleError($r, 'odświeżenie połączenia'));
    }
    $c['access'] = sealToken($r['json']['access_token']);
    $c['accessExp'] = time() + (int) ($r['json']['expires_in'] ?? 3600) - 60;
    ytSave($uid, $c);
    return ['accessToken' => $r['json']['access_token'], 'expiresAt' => $c['accessExp']];
}
function ytDisconnect(int $uid): void {
    $c = ytConfig($uid);
    $tok = openToken($c['refresh'] ?? null);
    if ($tok) { try { ytCall('POST', ytUrl('revoke'), ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['token' => $tok])); } catch (YtError) { /* i tak zapominamy */ } }
    unset($c['refresh'], $c['access'], $c['accessExp'], $c['channel'], $c['connectedAt']);
    ytSave($uid, $c);
}
function ytCallbackPage(bool $ok, string $msg): never {
    http_response_code($ok ? 200 : 400);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    $m = htmlspecialchars($msg, ENT_QUOTES);
    $icon = $ok ? '✓' : '!';
    $col = $ok ? '#2fbf71' : '#ff7a7a';
    echo "<!doctype html><html lang=\"pl\"><head><meta charset=\"utf-8\"><title>CloudCut — YouTube</title><meta name=\"viewport\" content=\"width=device-width\">"
        . "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1014;color:#e6e9f0;font:16px/1.5 system-ui,sans-serif}"
        . "main{max-width:440px;padding:32px;text-align:center}b{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 16px;border-radius:50%;background:$col;color:#0e1014;font-size:28px}</style></head>"
        . "<body><main><b>$icon</b><h1 style=\"font-size:20px\">CloudCut i YouTube</h1><p>$m</p></main></body></html>";
    exit;
}
