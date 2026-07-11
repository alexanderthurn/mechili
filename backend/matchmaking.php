<?php
/**
 * MECHILI quick-match endpoint.
 *
 * Bundled at backend/matchmaking.php and deployed with the game. The client
 * resolves the URL in net.ts (relative by default; remote on localhost).
 * Override with ?match=<url>.
 *
 * Protocol (all GET, JSON responses):
 *   ?action=join&peer=<peerjs-id>
 *       If a fresh waiting peer exists, it is consumed and returned as
 *       {"match":"<their-peer-id>"} — the caller then connects via PeerJS.
 *       Otherwise the caller is stored as waiting: {"match":null}.
 *       Repeating the call acts as the heartbeat that keeps the entry fresh.
 *   ?action=leave&peer=<peerjs-id>
 *       Removes the caller's waiting entry.
 *
 * Entries not refreshed for TTL seconds are deleted automatically — the
 * waiting client heartbeats every 5s, so 15s means "gone".
 */

const TTL = 15;
const STORE = __DIR__ . '/mechili-rooms.json';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? '';
$peer = $_GET['peer'] ?? '';
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
$rooms = array_values(array_filter($rooms, fn($r) => $now - $r['ts'] <= TTL));

$match = null;
if ($action === 'leave') {
    $rooms = array_values(array_filter($rooms, fn($r) => $r['peer'] !== $peer));
} else { // join / heartbeat
    foreach ($rooms as $i => $r) {
        if ($r['peer'] !== $peer) {
            $match = $r['peer'];
            array_splice($rooms, $i, 1); // consumed — one opponent each
            break;
        }
    }
    if ($match === null) {
        // (re-)register the caller as waiting
        $rooms = array_values(array_filter($rooms, fn($r) => $r['peer'] !== $peer));
        $rooms[] = ['peer' => $peer, 'ts' => $now];
    } else {
        // matched: our own waiting entry (if any) is obsolete
        $rooms = array_values(array_filter($rooms, fn($r) => $r['peer'] !== $peer));
    }
}

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($rooms));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

echo json_encode(['match' => $match]);
