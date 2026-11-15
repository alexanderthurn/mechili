<?php
/**
 * Press kit ZIP, packed when someone asks for it (press.html → backend/press.php).
 *
 * Nothing is built or stored for it: it zips the site's fixed public files —
 * press/ (texts, logo, developer photo) and the 4K screenshots in
 * marketing/screenshots/4k/ — plus the icon. Images are stored, not deflated
 * (they are compressed already), so it is quick. In the repo these live in public/.
 */
declare(strict_types=1);

function fail(int $code, string $message): void
{
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

if (!class_exists('ZipArchive')) fail(500, 'ZIP support is not available on this server.');

$site = dirname(__DIR__);

/** name in the ZIP => file on disk */
$files = [];
foreach (glob($site . '/press/*') ?: [] as $path) {
    $name = basename($path);
    if (str_contains($name, '-small.')) continue; // the page's small preview, not for print
    $files[preg_match('/\.(png|jpe?g)$/i', $name) ? (str_contains($name, 'logo') ? "logos/$name" : "developer/$name") : $name] = $path;
}
$files['logos/melodan-icon-256.png'] = $site . '/favicon-256.png';
$shots = glob($site . '/marketing/screenshots/4k/sc*.jpg') ?: [];
natsort($shots);
foreach ($shots as $path) {
    $files['screenshots/melodan-screenshot-' . preg_replace('/\D/', '', basename($path)) . '.jpg'] = $path;
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
    if (!is_file($path)) continue;
    $inZip = 'melodan-presskit/' . $name;
    $zip->addFile($path, $inZip);
    if (preg_match('/\.(jpe?g|png|webp)$/i', $name)) $zip->setCompressionName($inZip, ZipArchive::CM_STORE);
    $added++;
}
$zip->close();
if ($added === 0) fail(500, 'No press kit files found.');

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="melodan-presskit.zip"');
header('Content-Length: ' . (string) filesize($tmp));
header('Cache-Control: no-store');
readfile($tmp);
