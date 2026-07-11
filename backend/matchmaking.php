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
 *   ?action=host&peer=<peerjs-id>&name=<display-name>
 *       Register a public custom room (heartbeat via repeat calls).
 *       {"ok":true} or {"error":"..."}
 *   ?action=list
 *       Open public rooms: {"rooms":[{"name":"...","peer":"..."}]}
 *   ?action=leave&peer=<peerjs-id>
 *       Remove the caller's queue or lobby entry.
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
        if (($r['kind'] ?? '') !== 'lobby') continue;
        if ($now - ($r['ts'] ?? 0) > TTL) continue;
        $open[] = ['name' => $r['name'] ?? '', 'peer' => $r['peer'] ?? ''];
    }
    echo json_encode(['rooms' => $open]);
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
    $rooms[] = ['peer' => $peer, 'name' => $name, 'kind' => 'lobby', 'ts' => $now];
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
