#!/usr/bin/env python3
"""All voice lines of the draft units (assets/data/units/*.jsonc) with their saved voices.

Files: misc/sfx/bank/vo/<unit>/<unit>_<category>_<n>.mp3 (with --takes >1: _t<take>) — <n> is the line's position in the jsonc.
Resumable (existing takes are skipped). Usage (ELEVENLABS_API_KEY set):
  python3 gen_unit_lines.py [--model eleven_v4] [--takes 1] [unit ...]
"""
import argparse, concurrent.futures as cf, json, os, re, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# the unit files live in the game data now (listed in pack.jsonc "drafts" until they have models)
DRAFTS = os.path.join(HERE, '..', '..', '..', 'assets', 'data', 'units')
OUT = os.path.join(HERE, 'vo')
KEY = os.environ['ELEVENLABS_API_KEY']


def jsonc(path):
    s = open(path).read()
    out, i, ins = [], 0, False
    while i < len(s):
        c = s[i]
        if ins:
            out.append(c)
            if c == '\\':
                out.append(s[i + 1]); i += 2; continue
            if c == '"':
                ins = False
        elif c == '"':
            ins = True; out.append(c)
        elif s.startswith('//', i):
            while i < len(s) and s[i] != '\n':
                i += 1
            continue
        elif s.startswith('/*', i):
            i = s.index('*/', i) + 2
            continue
        else:
            out.append(c)
        i += 1
    return json.loads(re.sub(r',(\s*[}\]])', r'\1', ''.join(out)))


def tts(voice, text, model, out):
    if os.path.exists(out):
        return
    body = {'text': text, 'model_id': model}
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_192',
                                 data=json.dumps(body).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            open(out, 'wb').write(data)
            return
        except Exception as e:
            if attempt == 3:
                print('FAIL', os.path.basename(out), e, flush=True)
                return
            time.sleep(5 * (attempt + 1))


ap = argparse.ArgumentParser()
ap.add_argument('--model', default='eleven_v4')
ap.add_argument('--takes', type=int, default=1)
ap.add_argument('units', nargs='*')
a = ap.parse_args()
units = a.units or jsonc(os.path.join(DRAFTS, '..', 'pack.jsonc'))['drafts']
jobs = []
for u in units:
    d = jsonc(os.path.join(DRAFTS, u + '.jsonc'))
    voice = d['voice']['externalIds'][0].get('id')
    if not voice:
        print('no voice id:', u); continue
    os.makedirs(os.path.join(OUT, u), exist_ok=True)
    for cat, lines in d['voice']['lines'].items():
        for i, text in enumerate(lines, 1):
            for t in range(1, a.takes + 1):
                jobs.append((voice, text, a.model, os.path.join(OUT, u, f'{u}_{cat}_{i}' + (f'_t{t}' if a.takes > 1 else '') + '.mp3')))
todo = [j for j in jobs if not os.path.exists(j[3])]
print(len(jobs), 'takes,', len(todo), 'to do, ~', sum(len(j[1]) for j in todo), 'characters', flush=True)
with cf.ThreadPoolExecutor(3) as ex:
    list(ex.map(lambda j: tts(*j), todo))
print('done', flush=True)
