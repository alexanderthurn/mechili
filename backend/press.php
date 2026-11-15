<?php
/**
 * Press kit ZIP, packed when someone asks for it (press.html → backend/press.php).
 *
 * Nothing is built or stored for it: the press texts sit next to this script
 * (backend/press/*.md), and the 4K screenshots, logo and developer photo are
 * the files the site already ships in assets/ — under hashed names
 * (sc1-<hash>.jpg …), found here by pattern. Images are stored, not deflated
 * (they are compressed already), so it is quick.
 */
declare(strict_types=1);

function fail(int $code, string $message): void
{
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

/** the newest file in $dir whose name matches $regex (an old build's leftover loses) */
function newest(string $dir, string $regex): ?string
{
    $best = null;
    foreach (scandir($dir) ?: [] as $name) {
        if (!preg_match($regex, $name)) continue;
        $path = $dir . '/' . $name;
        if ($best === null || filemtime($path) > filemtime($best)) $best = $path;
    }
    return $best;
}

if (!class_exists('ZipArchive')) fail(500, 'ZIP support is not available on this server.');

$site = dirname(__DIR__);
$assets = $site . '/assets';
if (!is_dir($assets)) fail(500, 'Site assets not found.');
// Vite's hash: 8 characters of [A-Za-z0-9_-]
$hash = '[A-Za-z0-9_-]{8}';

/** ZIP name => file on disk */
$files = [];
foreach (['factsheet.md', 'descriptions.md', 'press-release-playtest.md'] as $text) {
    $files[$text] = __DIR__ . '/press/' . $text;
}
$files['logos/melodan-logo.png'] = newest($assets, "/^logo-trimmed-$hash\\.png$/");
$files['logos/melodan-icon-256.png'] = $site . '/favicon-256.png';
$files['developer/alexander-thurn.jpg'] = newest($assets, "/^alexander-thurn-$hash\\.jpg$/");
$shots = [];
foreach (scandir($assets) ?: [] as $name) {
    if (preg_match("/^sc(\\d+)-$hash\\.jpg$/", $name, $m)) $shots[(int) $m[1]] = true;
}
ksort($shots);
foreach (array_keys($shots) as $n) {
    $files["screenshots/melodan-screenshot-$n.jpg"] = newest($assets, "/^sc$n-$hash\\.jpg$/");
}

$tmp = tempnam(sys_get_temp_dir(), 'presskit');
if ($tmp === false) fail(500, 'No temp file.');
register_shutdown_function(static function () use ($tmp): void {
    if (is_file($tmp)) @unlink($tmp);
});

$zip = new ZipArchive();
if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) fail(500, 'Could not create the ZIP.');
$added = 0;
foreach ($files as $name => $path) {
    if ($path === null || !is_file($path)) continue;
    $inZip = 'melodan-presskit/' . $name;
    $zip->addFile($path, $inZip);
    if (preg_match('/\.(jpe?g|png|webp)$/i', $name) && method_exists($zip, 'setCompressionName')) {
        $zip->setCompressionName($inZip, ZipArchive::CM_STORE);
    }
    $added++;
}
$zip->close();
if ($added === 0) fail(500, 'No press kit files found.');

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="melodan-presskit.zip"');
header('Content-Length: ' . (string) filesize($tmp));
header('Cache-Control: no-store');
readfile($tmp);
