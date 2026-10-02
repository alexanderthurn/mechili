<?php
/**
 * MELODAN diagnostics — desync and error reports, file-based (like stats.php).
 *
 * Each report is one JSON file under stats/diag/. A desync is reported by every
 * client of the match, filed under the same match key (game version + seed), so the
 * host's and the guests' views of the same moment sit next to each other.
 *
 * Protocol (JSON, CORS open for submit):
 *   OPTIONS
 *       CORS preflight.
 *   POST ?action=submit   body: report JSON (diagnostics.ts; kind desync | error | manual)
 *       {"ok":true,"id":"..."}
 *   GET  ?action=list&key=<ADMIN_KEY>[&limit=<n>]
 *       Reports grouped by match, newest first (no event payloads).
 *       {"groups":[{matchKey,ts,reports:[{id,ts,kind,key,role,name,round,appVersion,platform}]}]}
 *   GET  ?action=get&key=<ADMIN_KEY>&id=<id>
 *       One full report.
 *   GET  ?action=match&key=<ADMIN_KEY>&matchKey=<matchKey>
 *       Every report of one match (any client, any kind), oldest first, in one JSON
 *       document — the whole story of a match to copy or download in one go.
 *       {"matchKey":...,"count":n,"reports":[...]}
 *
 * Reading needs the admin key: reports carry player names and system details.
 */

const DATA_DIR = __DIR__ . '/stats';
const DIAG_DIR = DATA_DIR . '/diag';
const MAX_BODY = 8_388_608; // 8 MiB — a manual report carries the whole match
const MAX_LIST = 300;
/** oldest reports beyond this many are deleted on submit */
const MAX_FILES = 3000;

/** Injected at deploy time (same placeholder as suggest.php). */
const ADMIN_KEY = '__ADMIN_KEY__';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

ensureDirs();
$action = $_GET['action'] ?? ($_SERVER['REQUEST_METHOD'] === 'POST' ? 'submit' : '');

try {
    if ($action === 'submit') {
        handleSubmit();
    } elseif ($action === 'list') {
        requireAdmin();
        handleList();
    } elseif ($action === 'get') {
        requireAdmin();
        handleGet();
    } elseif ($action === 'match') {
        requireAdmin();
        handleMatch();
    } else {
        respond(['error' => 'bad action'], 400);
    }
} catch (Throwable $e) {
    respond(['error' => 'server error'], 500);
}

// ---------------------------------------------------------------------------

function adminKey(): ?string {
    if (ADMIN_KEY !== '' && ADMIN_KEY !== '__ADMIN_KEY__') {
        $k = trim(ADMIN_KEY);
        if ($k !== '') return $k;
    }
    foreach (['STATS_KEY', 'CHAT_KEY'] as $envName) {
        $env = getenv($envName);
        if (is_string($env) && trim($env) !== '') return trim($env);
    }
    return null;
}

function requireAdmin(): void {
    $key = adminKey();
    $given = (string)($_GET['key'] ?? '');
    if ($key === null || !hash_equals($key, $given)) {
        respond(['error' => 'forbidden'], 403);
    }
}

function ensureDirs(): void {
    if (!is_dir(DIAG_DIR)) {
        @mkdir(DIAG_DIR, 0755, true);
    }
    $deny = DATA_DIR . '/.htaccess';
    if (!is_file($deny)) {
        @file_put_contents($deny, "Require all denied\n");
    }
}

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function clean(string $s, int $max): string {
    return substr(preg_replace('/[^A-Za-z0-9_\-]/', '', $s), 0, $max);
}

/** @return list<string> report files, oldest first (file names start with the timestamp) */
function diagFiles(): array {
    $files = glob(DIAG_DIR . '/*.json') ?: [];
    sort($files, SORT_STRING);
    return $files;
}

function handleSubmit(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(['error' => 'POST required'], 405);
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || $raw === '') respond(['error' => 'empty body'], 400);
    if (strlen($raw) > MAX_BODY) respond(['error' => 'too large'], 413);
    $data = json_decode($raw, true);
    if (!is_array($data)) respond(['error' => 'bad json'], 400);

    $kind = clean((string)($data['kind'] ?? 'error'), 16) ?: 'error';
    $ts = time();
    $data['serverTs'] = $ts;
    // the match: same version + seed on every client of it
    $seed = isset($data['seed']) ? (string)(int)$data['seed'] : '';
    $matchKey = $seed !== ''
        ? substr(sha1((string)($data['gameVersion'] ?? '') . ':' . $seed), 0, 12)
        : 'nomatch';
    $data['matchKey'] = $matchKey;
    $id = $ts . '_' . $matchKey . '_' . $kind . '_' . bin2hex(random_bytes(4));
    $data['id'] = $id;

    $path = DIAG_DIR . '/' . $id . '.json';
    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, json_encode($data)) === false || !@rename($tmp, $path)) {
        respond(['error' => 'write failed'], 500);
    }
    // keep the folder bounded
    $files = diagFiles();
    for ($i = 0; $i < count($files) - MAX_FILES; $i++) @unlink($files[$i]);
    respond(['ok' => true, 'id' => $id]);
}

function handleList(): void {
    $limit = max(1, min(MAX_LIST, (int)($_GET['limit'] ?? 100)));
    $files = array_reverse(diagFiles());
    $groups = [];
    $count = 0;
    foreach ($files as $file) {
        if ($count >= $limit) break;
        $data = json_decode((string)@file_get_contents($file), true);
        if (!is_array($data)) continue;
        $count++;
        $mk = (string)($data['matchKey'] ?? 'nomatch');
        if (!isset($groups[$mk])) $groups[$mk] = ['matchKey' => $mk, 'ts' => (int)($data['serverTs'] ?? 0), 'reports' => []];
        $groups[$mk]['reports'][] = [
            'id' => $data['id'] ?? basename($file, '.json'),
            'ts' => (int)($data['serverTs'] ?? 0),
            'kind' => $data['kind'] ?? '',
            'key' => $data['key'] ?? '',
            'role' => $data['role'] ?? '',
            'name' => $data['name'] ?? '',
            'round' => $data['round'] ?? null,
            'appVersion' => $data['appVersion'] ?? '',
            'platform' => $data['platform'] ?? '',
        ];
    }
    respond(['groups' => array_values($groups)]);
}

function handleGet(): void {
    $id = clean((string)($_GET['id'] ?? ''), 80);
    $path = DIAG_DIR . '/' . $id . '.json';
    if ($id === '' || !is_file($path)) respond(['error' => 'not found'], 404);
    $data = json_decode((string)file_get_contents($path), true);
    respond(is_array($data) ? $data : ['error' => 'unreadable']);
}

function handleMatch(): void {
    $mk = clean((string)($_GET['matchKey'] ?? ''), 32);
    if ($mk === '') respond(['error' => 'matchKey required'], 400);
    $reports = [];
    // file names are <ts>_<matchKey>_<kind>_<rand>.json — oldest first by name
    foreach (diagFiles() as $file) {
        if (strpos(basename($file), '_' . $mk . '_') === false) continue;
        $data = json_decode((string)@file_get_contents($file), true);
        if (is_array($data)) $reports[] = $data;
    }
    respond(['matchKey' => $mk, 'count' => count($reports), 'reports' => $reports]);
}
