<?php
/**
 * MECHILI matchmaking + public lobby endpoint.
 *
 * Bundled at backend/matchmaking.php and deployed with the game.
 *
 * Protocol (all GET, JSON responses):
 *   ?action=join&peer=<peerjs-id>
 *       Quick match: pair with another waiting quick-match peer, or queue.
 *       {"match":"<their-peer-id>"|null}
 *   ?action=host&peer=<peerjs-id>&name=<display-name>&mode=<1v1|2v2>&token=<owner-token>
 *       Register a public custom room (heartbeat via repeat calls).
 *       mode is a display/routing hint only (default "1v1") — the room list
 *       shows it so a joiner knows which connection flow to use.
 *       `token`: omit on first registration (a room name/peer is public —
 *       derived deterministically from the display name — so without this,
 *       anyone who can COMPUTE another room's peer id from its name could
 *       silently hijack or evict it). The response's own `token` must be
 *       echoed back on every later call for the SAME peer (heartbeats too);
 *       a mismatched token is rejected rather than allowed to overwrite.
 *       {"ok":true,"token":"..."} or {"error":"..."}
 *   ?action=list
 *       Open public rooms AND currently-running (spectatable) matches:
 *       {"rooms":[{"name":"...","peer":"...","mode":"...","kind":"lobby"|"spectate",
 *                  "roster":[{"name":"...","side":"a"|"b","connected":true}],
 *                  "round":1,"data":{...}}]}
 *       `kind=lobby` rows are joinable (waiting for a player); `kind=spectate`
 *       rows are a running match — connect to `peer` as a spectator instead.
 *       `roster`/`round`/`data` are only ever present on `kind=spectate` rows
 *       (see spectate-register) — a menu can match its own player name
 *       against `roster` to offer "resume your match" instead of "spectate".
 *       (`token` is never included here — ownership secret, display-only fields only.)
 *   ?action=leave&peer=<peerjs-id>&token=<owner-token>
 *       Remove the caller's queue, lobby, or spectate entry. `token` must
 *       match the entry's own (a mismatch — or missing token where the
 *       entry has one — refuses the removal instead of silently allowing
 *       anyone who knows the peer id to evict someone else's room).
 *   ?action=spectate-register&peer=<peerjs-id>&name=<room-name>&mode=<1v1|2v2>
 *                             &roster=<json>&round=<n>&data=<json>&token=<owner-token>
 *       Register/heartbeat a live match's spectator broadcast endpoint —
 *       same shape (and same token rule) as ?action=host, but tagged
 *       kind=spectate and kept alive for the WHOLE match (not just
 *       pre-match), so a match stays discoverable-for-watching after it
 *       starts. Shown by ?action=list.
 *       {"ok":true,"token":"..."} or {"error":"..."}
 *       `roster` is a JSON array of {name, side, connected} — refreshed every
 *       heartbeat, so it reflects drops/reconnects/AI-takeovers live.
 *       `round`/`data` are opaque passthrough (round: current round number;
 *       data: whatever extra display info a future menu wants — map, etc.)
 *   ?action=spectate-lookup&name=<room-name>
 *       Find a live match's spectate endpoint by room name.
 *       {"peer":"<peerjs-id>"|null}
 *
 * Entries not refreshed for TTL seconds are deleted automatically.
 * Clients heartbeat every 5s, so TTL 15s means "gone".
 */

const TTL = 15;
const STORE = __DIR__ . '/mechili-rooms.json';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? '';
$peer = $_GET['peer'] ?? '';
$name = trim($_GET['name'] ?? '');
$mode = trim($_GET['mode'] ?? '1v1');
if (!in_array($mode, ['1v1', '2v2'], true)) $mode = '1v1';
// caller-supplied proof of ownership for an existing entry — see the
// 'host'/'spectate-register'/'leave' handlers below. Never echoed back
// via ?action=list/spectate-lookup.
$token = $_GET['token'] ?? '';
if (strlen($token) > 64) $token = '';

/** Does $entry belong to the caller? True for a brand-new registration
 *  (no prior entry for this peer) or an entry with no stored token at all
 *  (a pre-existing/legacy entry from before this check existed — treated
 *  as unclaimed rather than breaking every already-open room on deploy).
 *  Otherwise the caller's token must match exactly. */
function ownsEntry(?array $entry, string $token): bool {
    if ($entry === null) return true;
    $stored = $entry['token'] ?? '';
    if ($stored === '') return true;
    return hash_equals($stored, $token);
}

/** decodes a caller-supplied JSON param defensively — bad/oversized input
 *  becomes null rather than corrupting the shared store file. */
function decodeJsonParam(?string $raw, int $maxLen) {
    if ($raw === null || $raw === '' || strlen($raw) > $maxLen) return null;
    $v = json_decode($raw, true);
    return $v === null && $raw !== 'null' ? null : $v;
}
/** `roster` has a well-defined client-side shape (RoomRosterEntry[] — see
 *  net.ts) and is echoed VERBATIM to every polling client via ?action=list,
 *  which trusts it enough to index into by seat and render directly —
 *  decodeJsonParam alone only proves it's valid JSON, not that it's an
 *  array of the expected shape, so a malformed roster (e.g. a bare number,
 *  or an array of non-objects) would previously have been stored and
 *  handed to every OTHER client's renderer as-is. */
function validRosterShape($v): bool {
    if (!is_array($v)) return false;
    foreach ($v as $entry) {
        if (!is_array($entry)) return false;
        if (!isset($entry['name']) || !is_string($entry['name'])) return false;
        if (!isset($entry['side']) || !in_array($entry['side'], ['a', 'b'], true)) return false;
        if (!isset($entry['connected']) || !is_bool($entry['connected'])) return false;
        if (isset($entry['aiControlled']) && !is_bool($entry['aiControlled'])) return false;
    }
    return true;
}
$rosterParam = decodeJsonParam($_GET['roster'] ?? null, 2000);
if ($rosterParam !== null && !validRosterShape($rosterParam)) $rosterParam = null;
$dataParam = decodeJsonParam($_GET['data'] ?? null, 2000);
$roundParam = isset($_GET['round']) ? max(0, min(9999, (int) $_GET['round'])) : null;

if ($action === 'list') {
    $fp = fopen(STORE, 'c+');
    if (!$fp || !flock($fp, LOCK_SH)) {
        http_response_code(500);
        echo json_encode(['error' => 'lock failed']);
        exit;
    }
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $rooms = $raw ? (json_decode($raw, true) ?: []) : [];
    $now = time();
    $open = [];
    foreach ($rooms as $r) {
        $kind = $r['kind'] ?? '';
        if ($kind !== 'lobby' && $kind !== 'spectate') continue;
        if ($now - ($r['ts'] ?? 0) > TTL) continue;
        $row = [
            'name' => $r['name'] ?? '',
            'peer' => $r['peer'] ?? '',
            'mode' => $r['mode'] ?? '1v1',
            'kind' => $kind,
        ];
        if ($kind === 'spectate') {
            if (isset($r['roster'])) $row['roster'] = $r['roster'];
            if (isset($r['round'])) $row['round'] = $r['round'];
            if (isset($r['data'])) $row['data'] = $r['data'];
        }
        $open[] = $row;
    }
    echo json_encode(['rooms' => $open]);
    exit;
}

if ($action === 'spectate-lookup') {
    if ($name === '' || strlen($name) > 32) {
        http_response_code(400);
        echo json_encode(['error' => 'bad room name']);
        exit;
    }
    $fp = fopen(STORE, 'c+');
    if (!$fp || !flock($fp, LOCK_SH)) {
        http_response_code(500);
        echo json_encode(['error' => 'lock failed']);
        exit;
    }
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $rooms = $raw ? (json_decode($raw, true) ?: []) : [];
    $now = time();
    $found = null;
    foreach ($rooms as $r) {
        if (($r['kind'] ?? '') !== 'spectate') continue;
        if ($now - ($r['ts'] ?? 0) > TTL) continue;
        if (($r['name'] ?? '') !== $name) continue;
        $found = $r['peer'] ?? null;
        break;
    }
    echo json_encode(['peer' => $found]);
    exit;
}

if ($peer === '' || strlen($peer) > 128 || !preg_match('/^[A-Za-z0-9_-]+$/', $peer)) {
    http_response_code(400);
    echo json_encode(['error' => 'bad peer id']);
    exit;
}

$fp = fopen(STORE, 'c+');
if (!$fp || !flock($fp, LOCK_EX)) {
    http_response_code(500);
    echo json_encode(['error' => 'lock failed']);
    exit;
}

$raw = stream_get_contents($fp);
$rooms = $raw ? (json_decode($raw, true) ?: []) : [];
$now = time();

// prune stale entries
$rooms = array_values(array_filter($rooms, fn($r) => $now - ($r['ts'] ?? 0) <= TTL));

// find any existing entry for this peer once, up front — every
// token-checked handler below needs it
$existingIdx = null;
foreach ($rooms as $i => $r) {
    if (($r['peer'] ?? '') === $peer) { $existingIdx = $i; break; }
}
$existing = $existingIdx !== null ? $rooms[$existingIdx] : null;

if ($action === 'leave') {
    if (!ownsEntry($existing, $token)) {
        flock($fp, LOCK_UN);
        fclose($fp);
        http_response_code(403);
        echo json_encode(['error' => 'token mismatch']);
        exit;
    }
    $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($rooms));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    echo json_encode(['ok' => true]);
    exit;
} elseif ($action === 'host') {
    if ($name === '' || strlen($name) > 32) {
        flock($fp, LOCK_UN);
        fclose($fp);
        http_response_code(400);
        echo json_encode(['error' => 'bad room name']);
        exit;
    }
    if (!ownsEntry($existing, $token)) {
        flock($fp, LOCK_UN);
        fclose($fp);
        http_response_code(403);
        echo json_encode(['error' => 'peer id already registered by someone else']);
        exit;
    }
    // reuse the existing owner token across heartbeats; mint a fresh one
    // only for a genuinely new (or previously unclaimed/legacy) entry
    $ownToken = ($existing['token'] ?? '') !== '' ? $existing['token'] : bin2hex(random_bytes(16));
    // one lobby entry per peer id; name is the display label
    $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
    $rooms[] = ['peer' => $peer, 'name' => $name, 'kind' => 'lobby', 'mode' => $mode, 'ts' => $now, 'token' => $ownToken];
    echo json_encode(['ok' => true, 'token' => $ownToken]);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($rooms));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    exit;
} elseif ($action === 'spectate-register') {
    if ($name === '' || strlen($name) > 32) {
        flock($fp, LOCK_UN);
        fclose($fp);
        http_response_code(400);
        echo json_encode(['error' => 'bad room name']);
        exit;
    }
    if (!ownsEntry($existing, $token)) {
        flock($fp, LOCK_UN);
        fclose($fp);
        http_response_code(403);
        echo json_encode(['error' => 'peer id already registered by someone else']);
        exit;
    }
    $ownToken = ($existing['token'] ?? '') !== '' ? $existing['token'] : bin2hex(random_bytes(16));
    // one spectate entry per peer id; name is the room it's spectating for
    $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
    $entry = ['peer' => $peer, 'name' => $name, 'kind' => 'spectate', 'mode' => $mode, 'ts' => $now, 'token' => $ownToken];
    if ($rosterParam !== null) $entry['roster'] = $rosterParam;
    if ($roundParam !== null) $entry['round'] = $roundParam;
    if ($dataParam !== null) $entry['data'] = $dataParam;
    $rooms[] = $entry;
    echo json_encode(['ok' => true, 'token' => $ownToken]);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($rooms));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    exit;
} elseif ($action === 'join') { // quick match only, never pairs with lobby hosts
    $match = null;
    foreach ($rooms as $i => $r) {
        if (($r['kind'] ?? 'queue') !== 'queue') continue;
        if (($r['peer'] ?? '') === $peer) continue;
        $match = $r['peer'];
        array_splice($rooms, $i, 1);
        break;
    }
    if ($match === null) {
        $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
        $rooms[] = ['peer' => $peer, 'kind' => 'queue', 'ts' => $now];
    } else {
        $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
    }
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($rooms));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    echo json_encode(['match' => $match]);
    exit;
} else {
    // previously an unconditional `else` (any unrecognized/misspelled
    // action silently fell through to quick-match pairing/queueing
    // instead of erroring) — the 400 response below was dead code that
    // could never actually run. Now genuinely reachable.
    flock($fp, LOCK_UN);
    fclose($fp);
    http_response_code(400);
    echo json_encode(['error' => 'bad action']);
    exit;
}
