#!/usr/bin/env python3
"""Spoken lines in other languages (Eleven v4) straight into the game: assets/audio/<lang>/<name>.ogg.

Translations: misc/sfx/bank/vo_<lang>.json — keys "commander:<id>", "unit:<id>", "narration"; for German
the old characters live in vo_de.json and the new units in vo_de_new.json. MP3 masters are kept in
misc/sfx/bank/vo_<lang>/<character>/. Resumable: existing .ogg files are skipped unless --redo.
Usage (repo root, ELEVENLABS_API_KEY set):
  python3 misc/sfx/bank/gen_languages.py --voice <id> --langs zh,ru,es [--redo] <character key> ...
"""
import argparse, concurrent.futures as cf, json, os, subprocess, time, urllib.request

B = 'misc/sfx/bank/'
KEY = os.environ['ELEVENLABS_API_KEY']


def lines_for(lang, key):
    if lang == 'de':
        d = json.load(open(B + 'vo_de.json'))
        if key in d:
            return d[key]
        new = json.load(open(B + 'vo_de_new.json'))
        return new.get(key.split(':', 1)[-1])
    return json.load(open(B + f'vo_{lang}.json')).get(key)


def file_name(key, cat, i):
    if key == 'narration':
        return {'welcome': 'narration_welcome', 'yearBegins': 'narration_year_begins'}[cat]
    kind, who = key.split(':', 1)
    if kind == 'commander':
        return {'pick': f'commander_{who}' if i == 1 else f'commander_{who}_{i}', 'pickRival': f'commander_{who}_rival_{i}',
                'win': f'commander_{who}_win_{i}', 'victory': f'commander_{who}_victory', 'defeat': f'commander_{who}_defeat'}[cat]
    return {'pick': f'unit_{who}_{i}', 'pickRival': f'unit_{who}_rival_{i}'}.get(cat, f'unit_{who}_{cat}_{i}')


def render(job):
    voice, lang, text, mp3, ogg, redo = job
    if os.path.exists(ogg) and not redo:
        return None
    body = {'text': text, 'model_id': 'eleven_v4', 'language_code': lang}
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_192',
                                 data=json.dumps(body).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                open(mp3, 'wb').write(r.read())
            break
        except Exception as e:
            if attempt == 3:
                return f'FAIL {ogg} {e}'
            time.sleep(5 * (attempt + 1))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=8',
                    '-c:a', 'libopus', '-b:a', '64k', ogg], check=True)
    return None


ap = argparse.ArgumentParser()
ap.add_argument('--voice', required=True)
ap.add_argument('--langs', required=True)
ap.add_argument('--redo', action='store_true')
ap.add_argument('keys', nargs='+')
a = ap.parse_args()
jobs = []
for key in a.keys:
    who = key.split(':', 1)[-1]
    for lang in a.langs.split(','):
        cats = lines_for(lang, key)
        if not cats:
            print('no', lang, 'lines for', key); continue
        os.makedirs(f'assets/audio/{lang}', exist_ok=True)
        os.makedirs(f'{B}vo_{lang}/{who}', exist_ok=True)
        for cat, lines in cats.items():
            for i, text in enumerate(lines, 1):
                name = file_name(key, cat, i)
                if not os.path.exists(f'assets/audio/{name}.ogg'):
                    print('no English counterpart for', name); continue
                jobs.append((a.voice, lang, text, f'{B}vo_{lang}/{who}/{name}.mp3', f'assets/audio/{lang}/{name}.ogg', a.redo))
with cf.ThreadPoolExecutor(3) as ex:
    for r in ex.map(render, jobs):
        if r:
            print(r, flush=True)
print(' '.join(a.keys), a.langs, len(jobs), 'lines', flush=True)
