<?php
/**
 * MECHILI match telemetry — file-based, parallelizable.
 *
 * Each match is one JSON file under stats/matches/. Writes never share a
 * lock (temp file + rename). Clients own all analysis; this endpoint only
 * stores and serves bulk downloads.
 *
 * Protocol (JSON, CORS open):
 *   OPTIONS
 *       CORS preflight.
 *   POST ?action=submit   body: MatchRecord JSON
 *       Store (or dedupe). {"ok":true,"id":"...","duplicate":bool}
 *   GET  ?action=list&since=<unix>&limit=<n>
 *       Lightweight index. {"matches":[{id,ts,...}],"nextSince":n|null}
 *   GET  ?action=bulk&since=<unix>&limit=<n>
 *       Full records. {"matches":[...],"nextSince":n|null}
 *   GET  ?action=get&id=<id>
 *       One full record.
 *   GET  ?action=count
 *       {"count":n}
 *
 * Missing / bad fields are filled with defaults. Reject only hard failures
 * (oversized body, unreadable JSON).
 */

const DATA_DIR = __DIR__ . '/stats';
const MATCH_DIR = DATA_DIR . '/matches';
const MAX_BODY = 1_048_576; // 1 MiB
const MAX_LIST = 500;
const SCHEMA = 1;

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
        handleList(false);
    } elseif ($action === 'bulk') {
        handleList(true);
    } elseif ($action === 'get') {
        handleGet();
    } elseif ($action === 'count') {
        echo json_encode(['count' => count(matchFiles())]);
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'bad action']);
    }
} catch (Throwable $e) {
    // never leak paths; clients treat any non-ok as "skip"
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
}

// ---------------------------------------------------------------------------

function ensureDirs(): void {
    if (!is_dir(MATCH_DIR)) {
        @mkdir(MATCH_DIR, 0755, true);
    }
    $deny = DATA_DIR . '/.htaccess';
    if (!is_file($deny)) {
        @file_put_contents($deny, "Require all denied\n");
    }
}

/** @return list<string> absolute paths, sorted by filename (ts_id.json) */
function matchFiles(): array {
    if (!is_dir(MATCH_DIR)) return [];
    $files = glob(MATCH_DIR . '/*.json') ?: [];
    sort($files, SORT_STRING);
    return $files;
}

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function handleSubmit(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['error' => 'POST required'], 405);
    }

    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || $raw === '') {
        respond(['error' => 'empty body'], 400);
    }
    if (strlen($raw) > MAX_BODY) {
        respond(['error' => 'too large'], 413);
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        respond(['error' => 'bad json'], 400);
    }

    $record = normalizeRecord($data);
    $id = $record['id'];
    $path = MATCH_DIR . '/' . $record['ts'] . '_' . $id . '.json';

    // content-addressed dedupe: same id already stored under any timestamp
    foreach (matchFiles() as $f) {
        if (substr($f, -strlen('_' . $id . '.json')) === '_' . $id . '.json') {
            respond(['ok' => true, 'id' => $id, 'duplicate' => true]);
        }
    }

    $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        respond(['error' => 'encode failed'], 500);
    }

    // atomic write — parallel clients never corrupt each other
    $tmp = MATCH_DIR . '/.' . $id . '.' . getmypid() . '.tmp';
    if (file_put_contents($tmp, $json) === false) {
        @unlink($tmp);
        respond(['error' => 'write failed'], 500);
    }
    if (!@rename($tmp, $path)) {
        // race: another writer won — treat as duplicate if the file exists
        @unlink($tmp);
        if (file_exists($path) || glob(MATCH_DIR . '/*_' . $id . '.json')) {
            respond(['ok' => true, 'id' => $id, 'duplicate' => true]);
        }
        respond(['error' => 'rename failed'], 500);
    }

    respond(['ok' => true, 'id' => $id, 'duplicate' => false]);
}

function handleList(bool $full): void {
    $since = max(0, (int)($_GET['since'] ?? 0));
    $limit = (int)($_GET['limit'] ?? 100);
    if ($limit < 1) $limit = 100;
    if ($limit > MAX_LIST) $limit = MAX_LIST;

    $out = [];
    $nextSince = null;

    foreach (matchFiles() as $path) {
        $base = basename($path, '.json');
        // filename: {ts}_{id}
        $us = strpos($base, '_');
        if ($us === false) continue;
        $ts = (int)substr($base, 0, $us);
        $id = substr($base, $us + 1);
        if ($ts < $since) continue;

        $raw = @file_get_contents($path);
        if ($raw === false) continue;
        $data = json_decode($raw, true);
        if (!is_array($data)) continue;

        if ($full) {
            $out[] = $data;
        } else {
            $out[] = [
                'id' => $data['id'] ?? $id,
                'ts' => $data['ts'] ?? $ts,
                'mode' => $data['mode'] ?? 'unknown',
                'patch' => $data['balancePatchId'] ?? '',
                'gameVersion' => $data['gameVersion'] ?? 0,
                'result' => $data['result'] ?? 'unknown',
                'rounds' => $data['rounds'] ?? 0,
            ];
        }

        $nextSince = $ts + 1;
        if (count($out) >= $limit) break;
    }

    respond([
        'matches' => $out,
        'nextSince' => count($out) >= $limit ? $nextSince : null,
    ]);
}

function handleGet(): void {
    $id = $_GET['id'] ?? '';
    if ($id === '' || !preg_match('/^[a-f0-9]{16,64}$/', $id)) {
        respond(['error' => 'bad id'], 400);
    }
    $files = glob(MATCH_DIR . '/*_' . $id . '.json') ?: [];
    if (!$files) {
        respond(['error' => 'not found'], 404);
    }
    $raw = file_get_contents($files[0]);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) {
        respond(['error' => 'corrupt'], 500);
    }
    respond($data);
}

/**
 * Fill defaults so old/partial clients never break ingest.
 * Id is content-addressed from a stable fingerprint (not the whole body),
 * so host+guest dual-submit and retries dedupe cleanly when fingerprints match.
 */
function normalizeRecord(array $data): array {
    $ts = (int)($data['ts'] ?? time());
    if ($ts <= 0) $ts = time();
    // clamp absurd future timestamps
    if ($ts > time() + 86400) $ts = time();

    $mode = (string)($data['mode'] ?? 'unknown');
    if (!in_array($mode, ['ai', 'mp', '2v2'], true)) $mode = 'unknown';

    $result = (string)($data['result'] ?? 'unknown');
    if (!in_array($result, ['victory', 'defeat', 'draw'], true)) $result = 'unknown';

    $replay = is_array($data['replay'] ?? null) ? $data['replay'] : [];
    $seed = (int)($replay['seed'] ?? $data['seed'] ?? 0);
    $gameVersion = (int)($data['gameVersion'] ?? 0);
    $patch = (string)($data['balancePatchId'] ?? (string)$gameVersion);

    $speciality = is_array($data['speciality'] ?? null) ? $data['speciality'] : [];
    $units = is_array($data['units'] ?? null) ? $data['units'] : [];
    $unlocked = is_array($data['unlocked'] ?? null) ? $data['unlocked'] : [];
    $names = is_array($data['names'] ?? null) ? $data['names'] : [];

    // fingerprint: enough to identify the match without perspective noise
    $fp = json_encode([
        'v' => SCHEMA,
        'gv' => $gameVersion,
        'patch' => $patch,
        'mode' => $mode,
        'seed' => $seed,
        'rounds' => (int)($data['rounds'] ?? 0),
        'result' => $result,
        'spec' => $speciality,
        'units' => $units,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $id = substr(hash('sha256', $fp === false ? (string)$ts : $fp), 0, 32);

    // allow client-supplied id only if it looks like a hex digest
    if (isset($data['id']) && is_string($data['id']) && preg_match('/^[a-f0-9]{16,64}$/', $data['id'])) {
        $id = $data['id'];
    }

    return [
        'schema' => SCHEMA,
        'id' => $id,
        'ts' => $ts,
        'gameVersion' => $gameVersion,
        'balancePatchId' => $patch,
        'mode' => $mode,
        'side' => (string)($data['side'] ?? 'a'),
        'result' => $result,
        'rounds' => max(0, (int)($data['rounds'] ?? 0)),
        'playerHp' => (int)($data['playerHp'] ?? 0),
        'enemyHp' => (int)($data['enemyHp'] ?? 0),
        'names' => [
            'local' => mb_substr((string)($names['local'] ?? ''), 0, 32),
            'opponent' => mb_substr((string)($names['opponent'] ?? ''), 0, 32),
        ],
        'speciality' => [
            'player' => $speciality['player'] ?? null,
            'enemy' => $speciality['enemy'] ?? null,
        ],
        'units' => $units,
        'unlocked' => $unlocked,
        'replay' => [
            'version' => (int)($replay['version'] ?? 1),
            'seed' => $seed,
            'settings' => is_array($replay['settings'] ?? null) ? $replay['settings'] : new stdClass(),
            'actions' => is_array($replay['actions'] ?? null) ? $replay['actions'] : [],
        ],
    ];
}
