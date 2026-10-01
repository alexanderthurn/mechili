#!/usr/bin/env python3
"""Voice-design previews for the draft units (no voice slot used — only saving a preview takes one).

Reads assets/data/units/<unit>.jsonc (voice prompt + lines), asks ElevenLabs for 3 previews per unit and
writes misc/sfx/bank/design/<unit>/preview_<i>.mp3 + previews.json (generated_voice_id per preview, needed
to save the chosen one later). Resumable: units with a previews.json are skipped.
Usage (ELEVENLABS_API_KEY set):  python3 design_voices.py [unit ...]
"""
import base64, json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# the unit files live in the game data now (listed in pack.jsonc "drafts" until they have models)
DRAFTS = os.path.join(HERE, '..', '..', '..', 'assets', 'data', 'units')
OUT = os.path.join(HERE, 'design')
KEY = os.environ['ELEVENLABS_API_KEY']
# eleven_ttv_v3 carries accents and age far better than eleven_multilingual_ttv_v2
MODEL = os.environ.get('TTV_MODEL', 'eleven_ttv_v3')


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


def sample_text(lines):
    picks = lines['pick'] + lines.get('pickRival', []) + lines.get('summon', []) + lines.get('death', [])
    text = ''
    for line in picks:
        if len(text) + len(line) + 1 > 600:
            break
        text += line + ' '
    return text.strip()


def design(unit):
    d = jsonc(os.path.join(DRAFTS, unit + '.jsonc'))
    folder = os.path.join(OUT, unit)
    if os.path.exists(os.path.join(folder, 'previews.json')):
        print(unit, 'already designed'); return
    prompt = d['voice']['externalIds'][0]['prompt']
    text = sample_text(d['voice']['lines'])
    body = {'voice_description': prompt, 'text': text, 'model_id': MODEL,
            'guidance_scale': 5, 'loudness': 0.5}
    req = urllib.request.Request('https://api.elevenlabs.io/v1/text-to-voice/design', data=json.dumps(body).encode(),
                                 headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.load(r)
    os.makedirs(folder, exist_ok=True)
    meta = []
    for i, p in enumerate(res.get('previews') or []):
        audio = p.get('audio_base_64') or p.get('audio_base64')
        if audio:
            open(os.path.join(folder, f'preview_{i + 1}.mp3'), 'wb').write(base64.b64decode(audio))
        meta.append({'preview': i + 1, 'generated_voice_id': p.get('generated_voice_id'), 'duration_secs': p.get('duration_secs')})
    json.dump({'unit': unit, 'name': d['name'], 'model': MODEL, 'prompt': prompt, 'text': text, 'previews': meta},
              open(os.path.join(folder, 'previews.json'), 'w'), indent=1, ensure_ascii=False)
    print(unit, len(meta), 'previews', flush=True)


units = sys.argv[1:] or jsonc(os.path.join(DRAFTS, '..', 'pack.jsonc'))['drafts']
for u in units:
    try:
        design(u)
    except Exception as e:
        print('FAIL', u, e, flush=True)
