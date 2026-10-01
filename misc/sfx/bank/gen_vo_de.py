#!/usr/bin/env python3
"""German takes of every current unit/commander line, with the original voices (eleven_v3, like the shipped English).

Lines: vo_de.json (same order as vo_en.json, which also holds the voice ids). Files:
vo_de_<character>_<category>_<n>_t<take>.mp3 — <n> matches the English line's position. Resumable.
Run from anywhere with ELEVENLABS_API_KEY set:  python3 gen_vo_de.py [takes]
"""
import concurrent.futures as cf, json, os, sys, time, urllib.request

BANK = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['ELEVENLABS_API_KEY']
TAKES = int(sys.argv[1]) if len(sys.argv) > 1 else 2
en = json.load(open(os.path.join(BANK, 'vo_en.json')))
de = json.load(open(os.path.join(BANK, 'vo_de.json')))


def gen(voice, text, out):
    if os.path.exists(out):
        return 0
    body = {'text': text, 'model_id': 'eleven_v3', 'language_code': 'de', 'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75}}
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_192',
                                 data=json.dumps(body).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            with open(out, 'wb') as fh:
                fh.write(data)
            return len(text)
        except Exception as e:
            if attempt == 3:
                print('FAIL', os.path.basename(out), e, flush=True)
                return 0
            time.sleep(5 * (attempt + 1))


jobs = []
for key, cats in de.items():
    who = key.split(':', 1)[1]
    voice = en[key]['voice']
    for cat, lines in cats.items():
        for i, text in enumerate(lines, 1):
            for t in range(1, TAKES + 1):
                jobs.append((voice, text, os.path.join(BANK, f'vo_de_{who}_{cat}_{i}_t{t}.mp3')))
print(len(jobs), 'takes', flush=True)
done = 0
with cf.ThreadPoolExecutor(3) as ex:
    for f in cf.as_completed([ex.submit(gen, *j) for j in jobs]):
        f.result()
        done += 1
        if done % 50 == 0:
            print(f'{done}/{len(jobs)}', flush=True)
print('done', flush=True)
