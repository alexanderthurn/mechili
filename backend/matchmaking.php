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
 *   ?action=host&peer=<peerjs-id>&name=<display-name>&mode=<1v1|2v2>
 *       Register a public custom room (heartbeat via repeat calls).
 *       mode is a display/routing hint only (default "1v1") — the room list
 *       shows it so a joiner knows which connection flow to use.
 *       {"ok":true} or {"error":"..."}
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
 *   ?action=leave&peer=<peerjs-id>
 *       Remove the caller's queue, lobby, or spectate entry.
 *   ?action=spectate-register&peer=<peerjs-id>&name=<room-name>&mode=<1v1|2v2>
 *                             &roster=<json>&round=<n>&data=<json>
 *       Register/heartbeat a live match's spectator broadcast endpoint —
 *       same shape as ?action=host, but tagged kind=spectate and kept alive
 *       for the WHOLE match (not just pre-match), so a match stays
 *       discoverable-for-watching after it starts. Shown by ?action=list.
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

/** decodes a caller-supplied JSON param defensively — bad/oversized input
 *  becomes null rather than corrupting the shared store file. */
function decodeJsonParam(?string $raw, int $maxLen) {
    if ($raw === null || $raw === '' || strlen($raw) > $maxLen) return null;
    $v = json_decode($raw, true);
    return $v === null && $raw !== 'null' ? null : $v;
}
$rosterParam = decodeJsonParam($_GET['roster'] ?? null, 2000);
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

if ($action === 'leave') {
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
    // one lobby entry per peer id; name is the display label
    $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
    $rooms[] = ['peer' => $peer, 'name' => $name, 'kind' => 'lobby', 'mode' => $mode, 'ts' => $now];
    echo json_encode(['ok' => true]);
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
    // one spectate entry per peer id; name is the room it's spectating for
    $rooms = array_values(array_filter($rooms, fn($r) => ($r['peer'] ?? '') !== $peer));
    $entry = ['peer' => $peer, 'name' => $name, 'kind' => 'spectate', 'mode' => $mode, 'ts' => $now];
    if ($rosterParam !== null) $entry['roster'] = $rosterParam;
    if ($roundParam !== null) $entry['round'] = $roundParam;
    if ($dataParam !== null) $entry['data'] = $dataParam;
    $rooms[] = $entry;
    echo json_encode(['ok' => true]);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($rooms));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    exit;
} else { // join — quick match only, never pairs with lobby hosts
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
}

http_response_code(400);
echo json_encode(['error' => 'bad action']);
flock($fp, LOCK_UN);
fclose($fp);
