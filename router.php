<?php
// Router dla wbudowanego serwera PHP (php -S ... router.php):
// /api/* obsługuje server/api.php, katalogi z danymi i kodem serwera są niedostępne,
// a reszta to zwykłe pliki statyczne.
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/server/api.php';
    return true;
}
if (preg_match('#^/(server|data)(/|$)#i', $path) || str_contains($path, '..') || str_contains($path, '/.') || preg_match('#\.(php|sqlite|db|bin)$#i', $path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Nie znaleziono';
    return true;
}
// pliki aplikacji zawsze świeże — po aktualizacji przeglądarka nie trzyma starej wersji
$file = realpath(__DIR__ . ($path === '/' ? '/index.html' : $path));
$types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8'];
$ext = strtolower(pathinfo((string) $file, PATHINFO_EXTENSION));
if ($file && str_starts_with($file, realpath(__DIR__)) && is_file($file) && isset($types[$ext])) {
    header('Content-Type: ' . $types[$ext]);
    header('Cache-Control: no-cache');
    header('X-Content-Type-Options: nosniff');
    readfile($file);
    return true;
}
return false;
