<?php
/**
 * MECHILI global menu chat. Upload next to matchmaking.php.
 *
 * Protocol (all GET, JSON responses):
 *   ?action=list
 *       {"sticky": string|null, "messages": [{name, text, ts}]}  (last 10)
 *   ?action=post&name=<name>&text=<text>
 *       Appends a message (flood-limited per IP).
 *   ?action=stick&key=<ADMIN_KEY>&text=<text>
 *       Admin only: sets the pinned message shown above the chat.
 *       Empty text clears it. Example:
 *       chat.php?action=stick&key=<your-key>&text=Patch+day+tonight!
 */

/**
 * Injected at deploy time: the GitHub Actions job replaces the placeholder
 * with the ADMIN_KEY repository secret. Alternatively set the
 * CHAT_KEY environment variable on the server. While neither is
 * configured, the stick action stays disabled (403).
 */
const ADMIN_KEY = '__ADMIN_KEY__';

function adminKey(): ?string {
    // Prefer the deploy-injected const; CHAT_KEY is only a fallback.
    // trim(): GitHub secrets / paste often include a trailing newline.
    if (ADMIN_KEY !== '' && ADMIN_KEY !== '__ADMIN_KEY__') {
        $k = trim(ADMIN_KEY);
        if ($k !== '') return $k;
    }
    $env = getenv('CHAT_KEY');
    if (is_string($env)) {
        $k = trim($env);
        if ($k !== '') return $k;
    }
    return null;
}
const MAX_MESSAGES = 10;
const MAX_TEXT = 200;
const MAX_NAME = 16;
const MIN_POST_INTERVAL = 3; // seconds per IP
const STORE = __DIR__ . '/chat.json';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$fp = fopen(STORE, 'c+');
if (!$fp || !flock($fp, LOCK_EX)) {
    http_response_code(500);
    echo json_encode(['error' => 'lock failed']);
    exit;
}

$raw = stream_get_contents($fp);
$state = $raw ? (json_decode($raw, true) ?: []) : [];
$state += ['sticky' => null, 'messages' => [], 'lastPost' => []];

$action = $_GET['action'] ?? 'list';
$now = time();

function clean(string $s, int $max): string {
    $s = trim(strip_tags($s));
    return mb_substr($s, 0, $max);
}

if ($action === 'post') {
    $name = clean($_GET['name'] ?? '', MAX_NAME);
    $text = clean($_GET['text'] ?? '', MAX_TEXT);
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $last = $state['lastPost'][$ip] ?? 0;
    if ($name !== '' && $text !== '' && $now - $last >= MIN_POST_INTERVAL) {
        $state['messages'][] = ['name' => $name, 'text' => $text, 'ts' => $now];
        $state['messages'] = array_slice($state['messages'], -MAX_MESSAGES);
        $state['lastPost'][$ip] = $now;
        // keep the rate-limit table from growing forever
        $state['lastPost'] = array_filter($state['lastPost'], fn($t) => $now - $t < 3600);
    }
} elseif ($action === 'stick') {
    $key = adminKey();
    if ($key !== null && hash_equals($key, trim($_GET['key'] ?? ''))) {
        $text = clean($_GET['text'] ?? '', MAX_TEXT);
        $state['sticky'] = $text === '' ? null : $text;
    } else {
        http_response_code(403);
    }
}

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($state));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

echo json_encode(['sticky' => $state['sticky'], 'messages' => $state['messages']]);
