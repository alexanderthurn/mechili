<?php
/**
 * MECHILI open-track player profiles + soft Elo MMR.
 *
 * Username is identity. Optional password (no email reset — forget it, lose
 * the name). Steam builds use a separate stack later.
 *
 * Storage:
 *   players/open/{shard}/{nameKey}.json
 *   players/sessions/{tokenHash}.json
 *   players/results/{matchId}.json
 *
 * Protocol (JSON, CORS open):
 *   GET  ?action=probe&name=
 *       { exists, hasPassword }
 *   POST ?action=claim  { name, password?, setPassword?, token? }
 *       Claim / create / unlock. { ok, player, token } or needsPassword / wrongPassword
 *   GET  ?action=hello&name=&token=
 *       Resume session or open unprotected profile. May return needsPassword.
 *   POST ?action=result  { …, token? }
 *       Elo for mp; if local name is protected, token required.
 *   GET  ?action=ladder&limit=
 *   GET  ?action=get&name=
 */

const PLAYERS_DIR = __DIR__ . '/players';
const OPEN_DIR = PLAYERS_DIR . '/open';
const RESULTS_DIR = PLAYERS_DIR . '/results';
const SESSIONS_DIR = PLAYERS_DIR . '/sessions';
const DEFAULT_MMR = 1000;
const ELO_K = 32;
const MAX_NAME = 16;
const MAX_LADDER = 100;
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 64;
const SESSION_TTL = 90 * 24 * 3600;
const TRACK = 'open';

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

$action = $_GET['action'] ?? ($_SERVER['REQUEST_METHOD'] === 'POST' ? 'result' : '');

try {
    if ($action === 'probe') {
        handleProbe();
    } elseif ($action === 'claim') {
        handleClaim();
    } elseif ($action === 'hello') {
        handleHello();
    } elseif ($action === 'get') {
        $name = displayName($_GET['name'] ?? '');
        if ($name === null) respond(['error' => 'bad name'], 400);
        $player = readPlayer(nameKey($name));
        if ($player === null) respond(['error' => 'not found'], 404);
        respond(['player' => publicPlayer($player)]);
    } elseif ($action === 'result') {
        handleResult();
    } elseif ($action === 'ladder') {
        handleLadder();
    } else {
        respond(['error' => 'bad action'], 400);
    }
} catch (Throwable $e) {
    respond(['error' => 'server error'], 500);
}

// ---------------------------------------------------------------------------

function ensureDirs(): void {
    foreach ([PLAYERS_DIR, OPEN_DIR, RESULTS_DIR, SESSIONS_DIR] as $d) {
        if (!is_dir($d)) @mkdir($d, 0755, true);
    }
    $deny = PLAYERS_DIR . '/.htaccess';
    if (!is_file($deny)) {
        @file_put_contents($deny, "Require all denied\n");
    }
}

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function displayName(string $raw): ?string {
    $raw = trim(strip_tags($raw));
    if (strlen($raw) < 2 || strlen($raw) > MAX_NAME) return null;
    $key = nameKey($raw);
    if (strlen($key) < 2) return null;
    return $raw;
}

function nameKey(string $name): string {
    return strtolower(preg_replace('/[^a-zA-Z0-9_-]/', '', $name) ?? '');
}

function shard(string $key): string {
    return substr(hash('crc32b', $key), 0, 2);
}

function playerPath(string $key): string {
    $dir = OPEN_DIR . '/' . shard($key);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    return $dir . '/' . $key . '.json';
}

function defaultPlayer(string $name): array {
    $now = time();
    return [
        'track' => TRACK,
        'id' => 'open:' . nameKey($name),
        'name' => $name,
        'nameKey' => nameKey($name),
        'mmr' => DEFAULT_MMR,
        'peakMmr' => DEFAULT_MMR,
        'wins' => 0,
        'losses' => 0,
        'draws' => 0,
        'games' => 0,
        'mpGames' => 0,
        'createdAt' => $now,
        'updatedAt' => $now,
    ];
}

function playerHasPassword(array $p): bool {
    return !empty($p['passwordHash']) && is_string($p['passwordHash']);
}

function publicPlayer(array $p): array {
    return [
        'track' => $p['track'] ?? TRACK,
        'id' => $p['id'] ?? ('open:' . ($p['nameKey'] ?? '')),
        'name' => $p['name'] ?? '',
        'mmr' => (int)($p['mmr'] ?? DEFAULT_MMR),
        'peakMmr' => (int)($p['peakMmr'] ?? $p['mmr'] ?? DEFAULT_MMR),
        'wins' => (int)($p['wins'] ?? 0),
        'losses' => (int)($p['losses'] ?? 0),
        'draws' => (int)($p['draws'] ?? 0),
        'games' => (int)($p['games'] ?? 0),
        'mpGames' => (int)($p['mpGames'] ?? 0),
        'hasPassword' => playerHasPassword($p),
    ];
}

function readPassword(?string $raw): ?string {
    if ($raw === null) return null;
    if ($raw === '') return '';
    $len = strlen($raw);
    if ($len < MIN_PASSWORD || $len > MAX_PASSWORD) return null;
    return $raw;
}

function readPlayer(string $key): ?array {
    $path = playerPath($key);
    if (!is_file($path)) return null;
    $raw = @file_get_contents($path);
    $data = $raw ? json_decode($raw, true) : null;
    return is_array($data) ? $data : null;
}

function savePlayer(array $player): void {
    $key = $player['nameKey'] ?? nameKey($player['name'] ?? '');
    if ($key === '') return;
    $path = playerPath($key);
    $fp = fopen($path, 'c+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        if ($fp) fclose($fp);
        @file_put_contents($path, json_encode($player, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        return;
    }
    writeLocked($fp, $player);
    flock($fp, LOCK_UN);
    fclose($fp);
}

/** @param resource $fp */
function writeLocked($fp, array $player): void {
    $json = json_encode($player, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, $json === false ? '{}' : $json);
    fflush($fp);
}

function sessionPath(string $tokenHash): string {
    return SESSIONS_DIR . '/' . $tokenHash . '.json';
}

function issueSession(string $nameKey): string {
    $token = bin2hex(random_bytes(24));
    $hash = hash('sha256', $token);
    @file_put_contents(sessionPath($hash), json_encode([
        'nameKey' => $nameKey,
        'exp' => time() + SESSION_TTL,
    ]));
    return $token;
}

function validateSession(?string $token, string $nameKey): bool {
    if ($token === null || $token === '' || !preg_match('/^[a-f0-9]{32,128}$/', $token)) {
        return false;
    }
    $path = sessionPath(hash('sha256', $token));
    if (!is_file($path)) return false;
    $raw = @file_get_contents($path);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) return false;
    if (($data['nameKey'] ?? '') !== $nameKey) return false;
    if ((int)($data['exp'] ?? 0) < time()) {
        @unlink($path);
        return false;
    }
    return true;
}

function handleProbe(): void {
    $name = displayName($_GET['name'] ?? '');
    if ($name === null) respond(['error' => 'bad name'], 400);
    $player = readPlayer(nameKey($name));
    if ($player === null) {
        respond(['exists' => false, 'hasPassword' => false]);
    }
    respond([
        'exists' => true,
        'hasPassword' => playerHasPassword($player),
        'name' => $player['name'] ?? $name,
    ]);
}

function handleHello(): void {
    $name = displayName($_GET['name'] ?? '');
    if ($name === null) respond(['error' => 'bad name'], 400);
    $token = isset($_GET['token']) ? (string)$_GET['token'] : '';
    $key = nameKey($name);
    $player = readPlayer($key);

    if ($player === null) {
        $player = defaultPlayer($name);
        savePlayer($player);
        $newToken = issueSession($key);
        respond(['ok' => true, 'created' => true, 'player' => publicPlayer($player), 'token' => $newToken]);
    }

    if (playerHasPassword($player)) {
        if (!validateSession($token, $key)) {
            respond(['ok' => false, 'needsPassword' => true, 'player' => null]);
        }
        // refresh display casing
        if (($player['name'] ?? '') !== $name) {
            $player['name'] = $name;
            $player['updatedAt'] = time();
            savePlayer($player);
        }
        respond(['ok' => true, 'player' => publicPlayer($player), 'token' => $token]);
    }

    if (($player['name'] ?? '') !== $name) {
        $player['name'] = $name;
        $player['updatedAt'] = time();
        savePlayer($player);
    }
    $newToken = $token !== '' && validateSession($token, $key) ? $token : issueSession($key);
    respond(['ok' => true, 'player' => publicPlayer($player), 'token' => $newToken]);
}

function handleClaim(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['error' => 'POST required'], 405);
    }
    $raw = file_get_contents('php://input');
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) respond(['error' => 'bad json'], 400);

    $name = displayName((string)($data['name'] ?? ''));
    if ($name === null) respond(['error' => 'bad name'], 400);

    $password = array_key_exists('password', $data) ? readPassword(is_string($data['password']) ? $data['password'] : null) : null;
    if (array_key_exists('password', $data) && $data['password'] !== null && $data['password'] !== '' && $password === null) {
        respond(['error' => 'bad password', 'hint' => 'Password must be ' . MIN_PASSWORD . '–' . MAX_PASSWORD . ' characters'], 400);
    }

    $setPassword = array_key_exists('setPassword', $data)
        ? readPassword(is_string($data['setPassword']) ? $data['setPassword'] : null)
        : null;
    if (array_key_exists('setPassword', $data) && $data['setPassword'] !== null && $data['setPassword'] !== '' && $setPassword === null) {
        respond(['error' => 'bad password', 'hint' => 'Password must be ' . MIN_PASSWORD . '–' . MAX_PASSWORD . ' characters'], 400);
    }

    $tokenIn = isset($data['token']) && is_string($data['token']) ? $data['token'] : '';
    $key = nameKey($name);
    $path = playerPath($key);
    $fp = fopen($path, 'c+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        if ($fp) fclose($fp);
        respond(['ok' => false, 'error' => 'lock failed'], 200);
    }

    $fileRaw = stream_get_contents($fp);
    $player = $fileRaw ? json_decode($fileRaw, true) : null;
    $created = false;

    if (!is_array($player)) {
        $player = defaultPlayer($name);
        $created = true;
        if ($setPassword !== null && $setPassword !== '') {
            $player['passwordHash'] = password_hash($setPassword, PASSWORD_DEFAULT);
        }
        writeLocked($fp, $player);
        flock($fp, LOCK_UN);
        fclose($fp);
        $tok = issueSession($key);
        respond(['ok' => true, 'created' => true, 'player' => publicPlayer($player), 'token' => $tok]);
    }

    // existing profile
    if (playerHasPassword($player)) {
        if (validateSession($tokenIn, $key)) {
            $player['name'] = $name;
            $player['updatedAt'] = time();
            writeLocked($fp, $player);
            flock($fp, LOCK_UN);
            fclose($fp);
            respond(['ok' => true, 'player' => publicPlayer($player), 'token' => $tokenIn]);
        }
        if ($password === null || $password === '') {
            flock($fp, LOCK_UN);
            fclose($fp);
            respond(['ok' => false, 'needsPassword' => true]);
        }
        if (!password_verify($password, $player['passwordHash'])) {
            flock($fp, LOCK_UN);
            fclose($fp);
            respond(['ok' => false, 'wrongPassword' => true]);
        }
        $player['name'] = $name;
        $player['updatedAt'] = time();
        writeLocked($fp, $player);
        flock($fp, LOCK_UN);
        fclose($fp);
        $tok = issueSession($key);
        respond(['ok' => true, 'player' => publicPlayer($player), 'token' => $tok]);
    }

    // unprotected existing — optional setPassword
    if ($setPassword !== null && $setPassword !== '') {
        $player['passwordHash'] = password_hash($setPassword, PASSWORD_DEFAULT);
    }
    $player['name'] = $name;
    $player['updatedAt'] = time();
    writeLocked($fp, $player);
    flock($fp, LOCK_UN);
    fclose($fp);
    $tok = issueSession($key);
    respond([
        'ok' => true,
        'created' => false,
        'player' => publicPlayer($player),
        'token' => $tok,
    ]);
}

/**
 * @return array{0:?resource,1:?resource,2:array,3:?array}
 */
function lockPair(string $keyA, string $keyB): array {
    $keys = [$keyA, $keyB];
    sort($keys, SORT_STRING);
    $fps = [];
    $players = [];
    foreach ($keys as $key) {
        $path = playerPath($key);
        $fp = fopen($path, 'c+');
        if (!$fp || !flock($fp, LOCK_EX)) {
            foreach ($fps as $f) { flock($f, LOCK_UN); fclose($f); }
            return [null, null, [], null];
        }
        $raw = stream_get_contents($fp);
        $p = $raw ? json_decode($raw, true) : null;
        if (!is_array($p)) {
            $p = defaultPlayer($key);
            $p['nameKey'] = $key;
            $p['id'] = 'open:' . $key;
        }
        $fps[$key] = $fp;
        $players[$key] = $p;
    }
    return [$fps[$keyA] ?? null, $fps[$keyB] ?? null, $players[$keyA], $players[$keyB] ?? null];
}

function eloExpected(float $a, float $b): float {
    return 1.0 / (1.0 + pow(10.0, ($b - $a) / 400.0));
}

/** @return array{0:int,1:int} */
function eloApply(int $ra, int $rb, float $scoreA): array {
    $ea = eloExpected($ra, $rb);
    $eb = eloExpected($rb, $ra);
    $na = (int)round($ra + ELO_K * ($scoreA - $ea));
    $nb = (int)round($rb + ELO_K * ((1.0 - $scoreA) - $eb));
    return [max(0, $na), max(0, $nb)];
}

function requireLocalAuth(array $player, ?string $token): bool {
    if (!playerHasPassword($player)) return true;
    $key = $player['nameKey'] ?? nameKey($player['name'] ?? '');
    return validateSession($token, $key);
}

function handleResult(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['error' => 'POST required'], 405);
    }
    $raw = file_get_contents('php://input');
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) respond(['error' => 'bad json'], 400);

    $matchId = preg_replace('/[^a-f0-9]/', '', strtolower((string)($data['matchId'] ?? ''))) ?? '';
    if (strlen($matchId) < 16 || strlen($matchId) > 64) {
        $matchId = substr(hash('sha256', $raw), 0, 32);
    }

    $token = isset($data['token']) && is_string($data['token']) ? $data['token'] : '';

    $resultPath = RESULTS_DIR . '/' . $matchId . '.json';
    if (is_file($resultPath)) {
        $localName = displayName((string)(($data['names']['local'] ?? '') ?: ''));
        $player = $localName ? readPlayer(nameKey($localName)) : null;
        respond([
            'ok' => true,
            'duplicate' => true,
            'player' => $player ? publicPlayer($player) : null,
            'opponent' => null,
        ]);
    }

    $mode = (string)($data['mode'] ?? 'unknown');
    $result = (string)($data['result'] ?? '');
    $localName = displayName((string)(($data['names']['local'] ?? '') ?: ''));
    $oppName = displayName((string)(($data['names']['opponent'] ?? '') ?: ''));
    if ($localName === null) respond(['error' => 'bad names'], 400);

    $localKey = nameKey($localName);
    $localPlayer = readPlayer($localKey);

    // AI / unknown
    if ($mode !== 'mp' || $oppName === null || !in_array($result, ['victory', 'defeat', 'draw'], true)) {
        if ($localPlayer === null) {
            $localPlayer = defaultPlayer($localName);
        }
        if (!requireLocalAuth($localPlayer, $token)) {
            respond(['ok' => false, 'error' => 'auth', 'needsPassword' => true, 'rated' => false], 200);
        }
        if ($mode === 'ai' && in_array($result, ['victory', 'defeat', 'draw'], true)) {
            $localPlayer = bumpAiStats($localPlayer, $result);
            savePlayer($localPlayer);
        } elseif ($localPlayer !== null && !is_file(playerPath($localKey))) {
            savePlayer($localPlayer);
        }
        @file_put_contents($resultPath, json_encode([
            'matchId' => $matchId,
            'mode' => $mode,
            'ts' => time(),
        ]));
        respond([
            'ok' => true,
            'duplicate' => false,
            'player' => publicPlayer($localPlayer),
            'opponent' => null,
            'rated' => false,
        ]);
    }

    $keyA = $localKey;
    $keyB = nameKey($oppName);
    if ($keyA === $keyB) {
        respond(['error' => 'same players'], 400);
    }

    [$fpA, $fpB, $a, $b] = lockPair($keyA, $keyB);
    if ($fpA === null || $fpB === null) {
        respond(['ok' => false, 'error' => 'lock failed', 'rated' => false], 200);
    }

    if (!requireLocalAuth($a, $token)) {
        flock($fpA, LOCK_UN);
        flock($fpB, LOCK_UN);
        fclose($fpA);
        fclose($fpB);
        respond(['ok' => false, 'error' => 'auth', 'needsPassword' => true, 'rated' => false], 200);
    }

    $a['name'] = $localName;
    $b['name'] = $oppName;

    $scoreA = $result === 'victory' ? 1.0 : ($result === 'defeat' ? 0.0 : 0.5);
    [$newA, $newB] = eloApply((int)$a['mmr'], (int)$b['mmr'], $scoreA);

    $a['mmr'] = $newA;
    $b['mmr'] = $newB;
    $a['peakMmr'] = max((int)($a['peakMmr'] ?? 0), $newA);
    $b['peakMmr'] = max((int)($b['peakMmr'] ?? 0), $newB);
    $a['mpGames'] = (int)($a['mpGames'] ?? 0) + 1;
    $b['mpGames'] = (int)($b['mpGames'] ?? 0) + 1;
    $a['games'] = (int)($a['games'] ?? 0) + 1;
    $b['games'] = (int)($b['games'] ?? 0) + 1;
    if ($result === 'victory') {
        $a['wins'] = (int)($a['wins'] ?? 0) + 1;
        $b['losses'] = (int)($b['losses'] ?? 0) + 1;
    } elseif ($result === 'defeat') {
        $a['losses'] = (int)($a['losses'] ?? 0) + 1;
        $b['wins'] = (int)($b['wins'] ?? 0) + 1;
    } else {
        $a['draws'] = (int)($a['draws'] ?? 0) + 1;
        $b['draws'] = (int)($b['draws'] ?? 0) + 1;
    }
    $now = time();
    $a['updatedAt'] = $now;
    $b['updatedAt'] = $now;

    writeLocked($fpA, $a);
    writeLocked($fpB, $b);
    flock($fpA, LOCK_UN);
    flock($fpB, LOCK_UN);
    fclose($fpA);
    fclose($fpB);

    @file_put_contents($resultPath, json_encode([
        'matchId' => $matchId,
        'mode' => 'mp',
        'result' => $result,
        'names' => ['local' => $localName, 'opponent' => $oppName],
        'mmr' => ['local' => $newA, 'opponent' => $newB],
        'ts' => $now,
    ], JSON_UNESCAPED_UNICODE));

    respond([
        'ok' => true,
        'duplicate' => false,
        'rated' => true,
        'player' => publicPlayer($a),
        'opponent' => publicPlayer($b),
    ]);
}

function bumpAiStats(array $p, string $result): array {
    $p['games'] = (int)($p['games'] ?? 0) + 1;
    if ($result === 'victory') $p['wins'] = (int)($p['wins'] ?? 0) + 1;
    elseif ($result === 'defeat') $p['losses'] = (int)($p['losses'] ?? 0) + 1;
    else $p['draws'] = (int)($p['draws'] ?? 0) + 1;
    $p['updatedAt'] = time();
    return $p;
}

function handleLadder(): void {
    $limit = (int)($_GET['limit'] ?? 50);
    if ($limit < 1) $limit = 50;
    if ($limit > MAX_LADDER) $limit = MAX_LADDER;

    $rows = [];
    $shards = glob(OPEN_DIR . '/*', GLOB_ONLYDIR) ?: [];
    foreach ($shards as $shardDir) {
        foreach (glob($shardDir . '/*.json') ?: [] as $file) {
            $raw = @file_get_contents($file);
            $p = $raw ? json_decode($raw, true) : null;
            if (!is_array($p)) continue;
            if ((int)($p['mpGames'] ?? 0) <= 0) continue;
            $rows[] = [
                'name' => $p['name'] ?? '',
                'mmr' => (int)($p['mmr'] ?? DEFAULT_MMR),
                'wins' => (int)($p['wins'] ?? 0),
                'losses' => (int)($p['losses'] ?? 0),
                'games' => (int)($p['mpGames'] ?? 0),
            ];
        }
    }
    usort($rows, fn($a, $b) => $b['mmr'] <=> $a['mmr'] ?: $b['wins'] <=> $a['wins']);
    respond(['ladder' => array_slice($rows, 0, $limit), 'track' => TRACK]);
}
