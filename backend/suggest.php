<?php
/**
 * MELODAN community suggestions.
 *
 * Public:
 *   POST ?action=submit  JSON { category, message, source?, specs?, website? }
 *       website = honeypot (must be empty). Saves to suggestions/data.json.
 *       On the first suggestion of each UTC day, emails NOTIFY_EMAIL with a
 *       link to suggest.html (no key in the mail).
 *
 * Admin (same ADMIN_KEY as chat sticky):
 *   GET  ?action=list&key=
 *   POST ?action=delete  JSON { key, id }  or  ?action=delete&key=&id=
 *
 * Storage survives FTP deploy via --exclude-glob backend/suggestions/
 */

const ADMIN_KEY = '__ADMIN_KEY__';
const NOTIFY_EMAIL = 'alex@feuerware.com';
const MAX_MESSAGE = 4000;
const MAX_SPECS = 4000;
const MAX_CATEGORY = 40;
const MAX_SOURCE = 40;
const MIN_POST_INTERVAL = 45; // seconds per IP
const MAX_ITEMS = 2000;
const DATA_DIR = __DIR__ . '/suggestions';
const STORE = DATA_DIR . '/data.json';

function adminKey(): ?string {
    $env = getenv('CHAT_KEY');
    if (is_string($env) && $env !== '') return $env;
    if (ADMIN_KEY !== '' && ADMIN_KEY !== '__ADMIN_KEY__') return ADMIN_KEY;
    return null;
}

function ensureStore(): void {
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0755, true);
    }
    $deny = DATA_DIR . '/.htaccess';
    if (!is_file($deny)) {
        file_put_contents($deny, "Require all denied\n");
    }
}

function defaultState(): array {
    return ['lastNotifyDay' => null, 'items' => [], 'lastPost' => []];
}

function clean(string $s, int $max): string {
    $s = trim(strip_tags($s));
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s) ?? $s;
    return mb_substr($s, 0, $max);
}

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function adminUrlHint(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'play.melodan.com';
    $base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/backend'), '/');
    return $scheme . '://' . $host . $base . '/suggest.html';
}

function maybeNotify(array &$state): void {
    $day = gmdate('Y-m-d');
    if (($state['lastNotifyDay'] ?? null) === $day) return;

    $url = adminUrlHint();
    $subject = 'MELODAN: first suggestion today';
    $body =
        "Someone sent a suggestion today (UTC {$day}).\n\n" .
        "Open the inbox here (enter your admin key):\n{$url}\n\n" .
        "— MELODAN suggest.php\n";
    $headers = 'From: melodan-suggest@' . ($_SERVER['HTTP_HOST'] ?? 'melodan.com') . "\r\n" .
        "Content-Type: text/plain; charset=UTF-8\r\n";
    @mail(NOTIFY_EMAIL, $subject, $body, $headers);
    $state['lastNotifyDay'] = $day;
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

ensureStore();

$fp = fopen(STORE, 'c+');
if (!$fp || !flock($fp, LOCK_EX)) {
    respond(['error' => 'lock failed'], 500);
}

$raw = stream_get_contents($fp);
$state = $raw ? (json_decode($raw, true) ?: []) : [];
if (!is_array($state)) $state = [];
$state = array_merge(defaultState(), $state);
if (!isset($state['items']) || !is_array($state['items'])) $state['items'] = [];
if (!isset($state['lastPost']) || !is_array($state['lastPost'])) $state['lastPost'] = [];

$rawBody = file_get_contents('php://input') ?: '';
$bodyJson = [];
if ($rawBody !== '') {
    $decoded = json_decode($rawBody, true);
    if (is_array($decoded)) $bodyJson = $decoded;
}

$action = $_GET['action'] ?? '';
if ($action === '' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string) ($bodyJson['action'] ?? 'submit');
}
$now = time();
$dirty = false;

try {
    if ($action === 'submit') {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            respond(['error' => 'POST required'], 405);
        }
        $body = $bodyJson;
        // honeypot — bots fill "website"
        if (trim((string) ($body['website'] ?? '')) !== '') {
            respond(['ok' => true]);
        }

        $category = clean((string) ($body['category'] ?? 'Other'), MAX_CATEGORY);
        $message = clean((string) ($body['message'] ?? ''), MAX_MESSAGE);
        $source = clean((string) ($body['source'] ?? ''), MAX_SOURCE);
        $specs = clean((string) ($body['specs'] ?? ''), MAX_SPECS);

        if ($message === '') {
            respond(['error' => 'empty message'], 400);
        }

        $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
        $last = (int) ($state['lastPost'][$ip] ?? 0);
        if ($now - $last < MIN_POST_INTERVAL) {
            respond(['error' => 'too fast', 'retryAfter' => MIN_POST_INTERVAL - ($now - $last)], 429);
        }

        $id = bin2hex(random_bytes(8));
        $state['items'][] = [
            'id' => $id,
            'ts' => $now,
            'category' => $category !== '' ? $category : 'Other',
            'message' => $message,
            'source' => $source,
            'specs' => $specs,
            'ip' => $ip,
        ];
        if (count($state['items']) > MAX_ITEMS) {
            $state['items'] = array_slice($state['items'], -MAX_ITEMS);
        }
        $state['lastPost'][$ip] = $now;
        $state['lastPost'] = array_filter(
            $state['lastPost'],
            fn($t) => $now - (int) $t < 86400,
        );

        maybeNotify($state);
        $dirty = true;
        respond(['ok' => true, 'id' => $id]);
    }

    if ($action === 'list') {
        $key = adminKey();
        $given = (string) ($_GET['key'] ?? '');
        if ($key === null || $given === '' || !hash_equals($key, $given)) {
            respond(['error' => 'forbidden'], 403);
        }
        $items = array_reverse($state['items']);
        respond([
            'ok' => true,
            'count' => count($items),
            'lastNotifyDay' => $state['lastNotifyDay'],
            'items' => $items,
        ]);
    }

    if ($action === 'delete') {
        $key = adminKey();
        $given = (string) ($bodyJson['key'] ?? $_GET['key'] ?? '');
        $id = clean((string) ($bodyJson['id'] ?? $_GET['id'] ?? ''), 64);
        if ($key === null || $given === '' || !hash_equals($key, $given)) {
            respond(['error' => 'forbidden'], 403);
        }
        if ($id === '') {
            respond(['error' => 'missing id'], 400);
        }
        $before = count($state['items']);
        $state['items'] = array_values(array_filter(
            $state['items'],
            fn($it) => ($it['id'] ?? '') !== $id,
        ));
        $dirty = count($state['items']) !== $before;
        respond(['ok' => true, 'deleted' => $dirty]);
    }

    respond(['error' => 'bad action'], 400);
} finally {
    if ($dirty) {
        $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, $json !== false ? $json : '{}');
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
}
