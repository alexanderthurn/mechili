<?php
/**
 * MECHILI match telemetry — file-based, parallelizable.
 *
 * Each match is one JSON file under stats/matches/. Writes never share a
 * lock (temp file + rename). Clients own all analysis; this endpoint only
 * stores and serves bulk downloads.
 *
 * Every real client in a match submits its OWN record (not just one side),
 * so a given match normally produces TWO files sharing the same `matchKey`
 * (a stable hash of `gameVersion:seed` — established before either side
 * could possibly diverge, unlike the per-submission dedupe id below, which
 * includes `result` and so differs between sides by construction: my
 * victory is your defeat). `matchKey` is what lets the two be found
 * together later (grouped listing below, and the filename itself).
 *
 * Protocol (JSON, CORS open):
 *   OPTIONS
 *       CORS preflight.
 *   POST ?action=submit   body: MatchRecord JSON
 *       Store (or dedupe a retried submission from the same side). {"ok":true,"id":"...","duplicate":bool}
 *   GET  ?action=list&since=<unix>&limit=<n>
 *       Lightweight index, oldest-of-the-batch first (forward cursor). {"matches":[{id,ts,...}],"nextSince":n|null}
 *   GET  ?action=bulk&since=<unix>&limit=<n>[&fields=summary]
 *       Full records, same cursor as `list`. `fields=summary` omits
 *       replay.actions (and shrinks settings to {}) for faster analysis
 *       downloads. {"matches":[...],"nextSince":n|null}
 *   GET  ?action=grouped&limit=<n>
 *       Lightweight index GROUPED by matchKey, most-recent-first — for a
 *       human browsing match history (replays.html), not a sync cursor.
 *       {"groups":[{matchKey,ts,records:[{id,ts,side,mode,gameVersion,result,rounds,
 *       playerHp,enemyHp,verifiedCount,lastVerifiedAt,names,roster,hasReplay},...]}]}
 *       `roster` (2v2+ only) is the full canonical seat list — every
 *       participant including AI-filled seats: [{seat,side,controller,name}].
 *       `names`/playerHp/enemyHp stay a 2-bucket "mine vs the other side"
 *       reduction regardless of how many seats are actually on each side.
 *       `hasReplay` is true when replay.actions is non-empty.
 *   GET  ?action=get&id=<id>
 *       One full record.
 *   GET  ?action=count
 *       {"count":n}
 *   POST|GET ?action=stripReplay&key=<ADMIN_KEY>&before=<unix>&dryRun=1
 *       Admin: clear replay.actions on records with ts < before (default: all).
 *       Keeps seed+settings. dryRun=1 reports counts without writing.
 *
 * Missing / bad fields are filled with defaults. Reject only hard failures
 * (oversized body, unreadable JSON).
 *
 * Schema 2 adds channel / techs / damage. Full action logs are optional —
 * clients default to empty actions (seed+settings stub for matchKey).
 */

const DATA_DIR = __DIR__ . '/stats';
const MATCH_DIR = DATA_DIR . '/matches';
const MAX_BODY = 1_048_576; // 1 MiB
const MAX_LIST = 500;
/** fingerprint version — bump when fingerprint inputs change (techs/damage) */
const FINGERPRINT_VERSION = 2;
const TS_BUCKET_SECONDS = 600; // 10 min — coarse enough that both sides' near-simultaneous submissions land in the same bucket

/**
 * Injected at deploy time (same placeholder as chat.php). Alternatively set
 * CHAT_KEY / STATS_KEY env. While unset, stripReplay stays disabled (403).
 */
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
        handleList(false);
    } elseif ($action === 'bulk') {
        handleList(true);
    } elseif ($action === 'grouped') {
        handleGrouped();
    } elseif ($action === 'get') {
        handleGet();
    } elseif ($action === 'count') {
        echo json_encode(['count' => count(matchFiles())]);
    } elseif ($action === 'stripReplay') {
        handleStripReplay();
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

function adminKey(): ?string {
    if (ADMIN_KEY !== '' && ADMIN_KEY !== '__ADMIN_KEY__') {
        $k = trim(ADMIN_KEY);
        if ($k !== '') return $k;
    }
    foreach (['STATS_KEY', 'CHAT_KEY'] as $envName) {
        $env = getenv($envName);
        if (is_string($env)) {
            $k = trim($env);
            if ($k !== '') return $k;
        }
    }
    return null;
}

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

function recordHasReplay(array $data): bool {
    $actions = $data['replay']['actions'] ?? null;
    return is_array($actions) && count($actions) > 0;
}

/** Drop action log (and optionally settings bulk) for analysis downloads. */
function summarizeRecordForBulk(array $data): array {
    if (isset($data['replay']) && is_array($data['replay'])) {
        $data['replay'] = [
            'version' => (int)($data['replay']['version'] ?? 1),
            'seed' => (int)($data['replay']['seed'] ?? 0),
            'settings' => new stdClass(),
            'actions' => [],
        ];
    }
    return $data;
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
    // {tsBucket}_{matchKey}_{side}_{id} — tsBucket keeps the listing roughly
    // chronological, matchKey groups both sides of one match adjacent to
    // each other (see the file docblock), side+id keep the two files apart.
    $tsBucket = intdiv($record['ts'], TS_BUCKET_SECONDS) * TS_BUCKET_SECONDS;
    $path = MATCH_DIR . '/' . $tsBucket . '_' . $record['matchKey'] . '_' . $record['side'] . '_' . $id . '.json';

    // content-addressed dedupe, scoped to the SAME side: catches a retried
    // submission from the same client cleanly, but two genuinely different
    // sides must never be treated as duplicates of each other just because
    // their content fingerprint happens to collide (e.g. both wrongly
    // reporting "victory", or a cheater's fabricated report happening to
    // match the honest side's summary fields) — that's exactly the
    // conflicting evidence this dual-submission exists to preserve, not
    // discard. Scoping by side is safe because the fingerprint never
    // includes `side` itself, so two legitimately different submissions
    // from the SAME side always collide identically regardless of order.
    $suffix = '_' . $record['side'] . '_' . $id . '.json';
    foreach (matchFiles() as $f) {
        if (substr($f, -strlen($suffix)) === $suffix) {
            // a matching Verify re-check never gets its own file (it would
            // just collide with the original) — that's the right call for
            // storage, but it left no trace a check ever happened, so a
            // fully-consistent match could never show as "verified".
            // Record the fact on the existing file instead of discarding it.
            if ($record['source'] === 'verify') {
                recordVerification($f);
            }
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

/** bumps the lightweight verifiedCount/lastVerifiedAt on an existing record
 *  — best-effort, no locking: losing a verify tick to a concurrent write is
 *  harmless (unlike the original submission, this never carries data that
 *  must not be lost). */
function recordVerification(string $path): void {
    $raw = @file_get_contents($path);
    if ($raw === false) return;
    $data = json_decode($raw, true);
    if (!is_array($data)) return;
    $data['verifiedCount'] = (int)($data['verifiedCount'] ?? 0) + 1;
    $data['lastVerifiedAt'] = time();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return;
    @file_put_contents($path, $json);
}

/**
 * Admin: strip replay.actions from stored records (keeps seed + settings).
 * Query: key, before (unix ts, optional — default now+1 so all match), dryRun.
 */
function handleStripReplay(): void {
    $key = adminKey();
    $provided = trim((string)($_GET['key'] ?? ''));
    if ($key === null || $provided === '' || !hash_equals($key, $provided)) {
        respond(['error' => 'forbidden'], 403);
    }

    $before = (int)($_GET['before'] ?? (time() + 1));
    if ($before <= 0) $before = time() + 1;
    $dryRun = isset($_GET['dryRun']) && $_GET['dryRun'] !== '0' && $_GET['dryRun'] !== '';

    $scanned = 0;
    $eligible = 0;
    $stripped = 0;
    $bytesBefore = 0;
    $bytesAfter = 0;

    foreach (matchFiles() as $path) {
        $scanned++;
        $raw = @file_get_contents($path);
        if ($raw === false) continue;
        $data = json_decode($raw, true);
        if (!is_array($data)) continue;

        $ts = (int)($data['ts'] ?? 0);
        if ($ts >= $before) continue;
        if (!recordHasReplay($data)) continue;

        $eligible++;
        $bytesBefore += strlen($raw);

        if (isset($data['replay']) && is_array($data['replay'])) {
            $data['replay']['actions'] = [];
        }

        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) continue;
        $bytesAfter += strlen($json);

        if (!$dryRun) {
            $tmp = $path . '.' . getmypid() . '.strip.tmp';
            if (file_put_contents($tmp, $json) === false) {
                @unlink($tmp);
                continue;
            }
            if (!@rename($tmp, $path)) {
                @unlink($tmp);
                continue;
            }
            $stripped++;
        }
    }

    respond([
        'ok' => true,
        'dryRun' => $dryRun,
        'before' => $before,
        'scanned' => $scanned,
        'eligible' => $eligible,
        'stripped' => $dryRun ? 0 : $stripped,
        'bytesBefore' => $bytesBefore,
        'bytesAfter' => $bytesAfter,
        'bytesSaved' => max(0, $bytesBefore - $bytesAfter),
    ]);
}

function handleList(bool $full): void {
    $since = max(0, (int)($_GET['since'] ?? 0));
    $limit = (int)($_GET['limit'] ?? 100);
    if ($limit < 1) $limit = 100;
    if ($limit > MAX_LIST) $limit = MAX_LIST;
    $summaryOnly = $full && (($_GET['fields'] ?? '') === 'summary');

    $out = [];
    $nextSince = null;

    foreach (matchFiles() as $path) {
        // the leading filename component is a `ts` BUCKET (see
        // TS_BUCKET_SECONDS) — always <= the real ts inside the file, so
        // it's a safe, cheap pre-skip for obviously-too-old files without
        // opening them, but the actual filter/cursor below always uses the
        // real per-record `ts` from content, never the bucket.
        $base = basename($path, '.json');
        $us = strpos($base, '_');
        $bucket = $us === false ? 0 : (int)substr($base, 0, $us);
        if ($bucket + TS_BUCKET_SECONDS <= $since) continue;

        $raw = @file_get_contents($path);
        if ($raw === false) continue;
        $data = json_decode($raw, true);
        if (!is_array($data)) continue;

        $ts = (int)($data['ts'] ?? 0);
        if ($ts < $since) continue;

        if ($full) {
            $out[] = $summaryOnly ? summarizeRecordForBulk($data) : $data;
        } else {
            $out[] = [
                'id' => $data['id'] ?? '',
                'ts' => $ts,
                'mode' => $data['mode'] ?? 'unknown',
                'patch' => $data['balancePatchId'] ?? '',
                'gameVersion' => $data['gameVersion'] ?? 0,
                'result' => $data['result'] ?? 'unknown',
                'rounds' => $data['rounds'] ?? 0,
                'channel' => $data['channel'] ?? '',
                'hasReplay' => recordHasReplay($data),
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

/**
 * Lightweight index grouped by matchKey, most-recent-first — for a human
 * browsing match history, not a sync cursor like list/bulk above (no
 * since/nextSince; `limit` caps the number of GROUPS, not records, so a
 * two-sided match's sibling record is never orphaned onto the next page).
 * Records with no matchKey (pre-migration files, if any exist on the
 * deployed server from before this endpoint existed) are skipped — they
 * still work fine through list/bulk/get, just don't appear here.
 */
function handleGrouped(): void {
    $limit = (int)($_GET['limit'] ?? 100);
    if ($limit < 1) $limit = 100;
    if ($limit > MAX_LIST) $limit = MAX_LIST;

    $groups = []; // matchKey => group; insertion order = newest-group-first, since we scan files newest-first
    foreach (array_reverse(matchFiles()) as $path) {
        $raw = @file_get_contents($path);
        if ($raw === false) continue;
        $data = json_decode($raw, true);
        if (!is_array($data)) continue;

        $matchKey = (string)($data['matchKey'] ?? '');
        if ($matchKey === '') continue;

        if (!isset($groups[$matchKey])) {
            if (count($groups) >= $limit) continue; // already have enough groups — but keep scanning for siblings of ones we do have
            $groups[$matchKey] = ['matchKey' => $matchKey, 'ts' => (int)($data['ts'] ?? 0), 'records' => []];
        }
        $groups[$matchKey]['records'][] = [
            'id' => $data['id'] ?? '',
            'ts' => (int)($data['ts'] ?? 0),
            'side' => $data['side'] ?? 'a',
            'source' => $data['source'] ?? 'player',
            'mode' => $data['mode'] ?? 'unknown',
            'gameVersion' => $data['gameVersion'] ?? 0,
            'result' => $data['result'] ?? 'unknown',
            'rounds' => $data['rounds'] ?? 0,
            'playerHp' => $data['playerHp'] ?? 0,
            'enemyHp' => $data['enemyHp'] ?? 0,
            // a matching Verify re-check never creates its own record (see
            // recordVerification) — these two fields are the only trace one
            // ever happened, tracked on the original record instead
            'verifiedCount' => (int)($data['verifiedCount'] ?? 0),
            'lastVerifiedAt' => (int)($data['lastVerifiedAt'] ?? 0),
            'names' => [
                'local' => $data['names']['local'] ?? '',
                'opponent' => $data['names']['opponent'] ?? '',
            ],
            // full canonical seat list (2v2+) — empty on records predating
            // this field, or a solo/1v1 record where names above already
            // says everything
            'roster' => is_array($data['roster'] ?? null) ? $data['roster'] : [],
            'hasReplay' => recordHasReplay($data),
        ];
    }

    respond(['groups' => array_values($groups)]);
}

function handleGet(): void {
    $id = $_GET['id'] ?? '';
    if ($id === '' || !preg_match('/^[a-f0-9]{16,64}$/', $id)) {
        respond(['error' => 'bad id'], 400);
    }
    // `side` disambiguates the rare case where two DIFFERENT sides' content
    // fingerprints collide (same id) — the dedupe in handleSubmit no longer
    // treats that as a duplicate (see its comment), so both files can now
    // genuinely coexist; optional and defaults to "first match" for callers
    // that don't have a side handy (unchanged prior behavior).
    // whitelisted to the only two legitimate values (same set enforced at
    // write time, see handleSubmit's own 'side' !== 'a'/'b' check below) —
    // unlike $id above, this was previously interpolated into the glob()
    // pattern completely unvalidated, letting a caller pass glob
    // metacharacters (*, ?, [...]) to broaden which files match.
    $side = $_GET['side'] ?? '';
    if ($side !== 'a' && $side !== 'b') $side = '';
    $pattern = $side !== '' ? "*_{$side}_{$id}.json" : "*_{$id}.json";
    $files = glob(MATCH_DIR . '/' . $pattern) ?: [];
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
 * Sanitize the full canonical seat list a 2v2+ match reports (the only
 * place all participants — including AI-filled seats — are recorded;
 * `names`/`speciality`/`units` stay a 2-bucket "mine vs the other side"
 * reduction for existing consumers). Missing/malformed entries are
 * dropped rather than defaulted — a partial roster is more honest than a
 * fabricated one.
 */
function normalizeRoster($raw): array {
    if (!is_array($raw)) return [];
    $out = [];
    foreach ($raw as $entry) {
        if (!is_array($entry)) continue;
        $side = (string)($entry['side'] ?? '');
        if ($side !== 'a' && $side !== 'b') continue;
        $controller = (string)($entry['controller'] ?? '');
        if ($controller !== 'human' && $controller !== 'ai') continue;
        $out[] = [
            'seat' => max(0, (int)($entry['seat'] ?? 0)),
            'side' => $side,
            'controller' => $controller,
            'name' => mb_substr((string)($entry['name'] ?? ''), 0, 32),
        ];
    }
    return $out;
}

/** Keep only player/enemy maps of string-keyed arrays/objects. */
function normalizeTeamBag($raw): array {
    if (!is_array($raw)) return [];
    $out = [];
    foreach (['player', 'enemy'] as $team) {
        if (!isset($raw[$team]) || !is_array($raw[$team])) continue;
        $out[$team] = $raw[$team];
    }
    return $out;
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

    // deliberately NOT part of the dedupe fingerprint below — a 'verify'
    // resubmission that reproduces the exact same result must still dedupe
    // against the original 'player' record (same side), that's the whole
    // point; only the CONTENT needs to match, not who/what produced it
    $source = (string)($data['source'] ?? 'player');
    if (!in_array($source, ['player', 'verify'], true)) $source = 'player';

    $channel = (string)($data['channel'] ?? '');
    if (!in_array($channel, ['open', 'steam'], true)) $channel = '';

    $schema = (int)($data['schema'] ?? 2);
    if ($schema !== 1 && $schema !== 2) $schema = 2;

    $replay = is_array($data['replay'] ?? null) ? $data['replay'] : [];
    $seed = (int)($replay['seed'] ?? $data['seed'] ?? 0);
    $gameVersion = (int)($data['gameVersion'] ?? 0);
    $patch = (string)($data['balancePatchId'] ?? (string)$gameVersion);

    $speciality = is_array($data['speciality'] ?? null) ? $data['speciality'] : [];
    $units = is_array($data['units'] ?? null) ? $data['units'] : [];
    $unlocked = is_array($data['unlocked'] ?? null) ? $data['unlocked'] : [];
    $techs = normalizeTeamBag($data['techs'] ?? null);
    $damage = normalizeTeamBag($data['damage'] ?? null);
    $names = is_array($data['names'] ?? null) ? $data['names'] : [];
    $roster = normalizeRoster($data['roster'] ?? null);

    $side = (string)($data['side'] ?? 'a');
    if ($side !== 'a' && $side !== 'b') $side = 'a';

    // fingerprint: enough to identify the match without perspective noise.
    // techs/damage included so schema-2 retries with richer summaries still
    // dedupe; empty objects for schema-1 clients keep fingerprints stable
    // within that client generation.
    $fp = json_encode([
        'v' => FINGERPRINT_VERSION,
        'gv' => $gameVersion,
        'patch' => $patch,
        'mode' => $mode,
        'seed' => $seed,
        'rounds' => (int)($data['rounds'] ?? 0),
        'result' => $result,
        'spec' => $speciality,
        'units' => $units,
        'techs' => $techs,
        'damage' => $damage,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $id = substr(hash('sha256', $fp === false ? (string)$ts : $fp), 0, 32);

    // allow client-supplied id only if it looks like a hex digest
    if (isset($data['id']) && is_string($data['id']) && preg_match('/^[a-f0-9]{16,64}$/', $data['id'])) {
        $id = $data['id'];
    }

    // stable across both sides of one match: gameVersion+seed are agreed
    // BEFORE either side could diverge (unlike the dedupe id above, which
    // bakes in `result` and so is never the same between the two sides of
    // a real match — see the file docblock).
    $matchKey = substr(hash('sha256', $gameVersion . ':' . $seed), 0, 12);

    $out = [
        'schema' => $schema,
        'id' => $id,
        'matchKey' => $matchKey,
        'ts' => $ts,
        'gameVersion' => $gameVersion,
        'balancePatchId' => $patch,
        'mode' => $mode,
        'side' => $side,
        'source' => $source,
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
        'roster' => $roster,
        'replay' => [
            'version' => (int)($replay['version'] ?? 1),
            'seed' => $seed,
            'settings' => is_array($replay['settings'] ?? null) ? $replay['settings'] : new stdClass(),
            'actions' => is_array($replay['actions'] ?? null) ? $replay['actions'] : [],
        ],
    ];

    if ($channel !== '') $out['channel'] = $channel;
    if ($techs !== []) $out['techs'] = $techs;
    if ($damage !== []) $out['damage'] = $damage;

    return $out;
}
