#!/usr/bin/env python3
"""Voice backups for re-cloning (Instant Voice Clone) after a voice is deleted from ElevenLabs.

- Voices that still exist: each reads "The North Wind and the Sun" (Aesop, public domain; the passage
  phoneticians use because it covers nearly every English sound) with Eleven v4 -> <name>.mp3
- Deleted voices: their shipped English lines (no hurt grunts) strung together -> <name>_lines.mp3
Mono 96 kbit/s — plenty for cloning, small in git. Resumable. Run from the repo root with
ELEVENLABS_API_KEY set:  python3 misc/sfx/voice-backups/make_backups.py
"""
import glob, json, os, re, subprocess, urllib.request

OUT = os.path.dirname(os.path.abspath(__file__))
TEXT = ("The North Wind and the Sun were disputing which was the stronger, when a traveler came along "
        "wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveler take "
        "his cloak off should be considered stronger than the other. Then the North Wind blew as hard as he "
        "could, but the more he blew the more closely did the traveler fold his cloak around him; and at last "
        "the North Wind gave up the attempt. Then the Sun shined out warmly, and immediately the traveler took "
        "off his cloak. And so the North Wind was obliged to confess that the Sun was the stronger of the two.")


def jsonc(path):
    s = open(path).read(); out = []; i = 0; ins = False
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
            i = s.index('*/', i) + 2; continue
        else:
            out.append(c)
        i += 1
    return json.loads(re.sub(r',(\s*[}\]])', r'\1', ''.join(out)))


def live_voices():
    v = {}
    for u in jsonc('assets/data/pack.jsonc')['drafts']:
        v[u] = jsonc(f'assets/data/units/{u}.jsonc')['voice']['externalIds'][0]['id']
    for u, vid in json.load(open('misc/sfx/bank/clone/clones.json')).items():
        v[u] = vid
    v['narrator'] = '6LvpN0wO2IdoFvZReYOV'
    return v


def read_passage(name, vid):
    out = os.path.join(OUT, f'{name}.mp3')
    if os.path.exists(out):
        return
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_192',
                                 data=json.dumps({'text': TEXT, 'model_id': 'eleven_v4'}).encode(),
                                 headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = r.read()
    tmp = out + '.tmp.mp3'
    open(tmp, 'wb').write(raw)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-ac', '1', '-b:a', '96k', out], check=True)
    os.remove(tmp)
    print('read', name, flush=True)


def string_lines(name, prefix):
    out = os.path.join(OUT, f'{name}_lines.mp3')
    if os.path.exists(out):
        return
    # every spoken line of this character (pick, rival, death, summon, win, victory, defeat), no hurt grunts
    files = sorted(f for f in glob.glob(prefix + '*.ogg') if '_hurt_' not in f)
    if not files:
        print('no lines for', name); return
    gap = os.path.join(OUT, 'gap.wav')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.4', gap], check=True)
    lst = os.path.join(OUT, 'list.txt')
    wavs = []
    with open(lst, 'w') as fh:
        for i, f in enumerate(files):
            w = os.path.join(OUT, f'_{i}.wav'); wavs.append(w)
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-ar', '44100', '-ac', '1', w], check=True)
            fh.write(f"file '{w}'\nfile '{gap}'\n")
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-b:a', '96k', out], check=True)
    for w in wavs + [gap, lst]:
        os.remove(w)
    print('strung', name, len(files), 'lines', flush=True)


if __name__ == '__main__':
    live = live_voices()
    for name, vid in live.items():
        read_passage(name, vid)
    # characters whose voice is gone: commanders + units without a live clone
    for c in ['addi', 'air', 'archer', 'cost', 'cursed', 'elite', 'flanky', 'giant', 'meteor', 'money', 'speed', 'tutor']:
        string_lines(f'commander_{c}', f'assets/audio/commander_{c}')  # commander_<c>.ogg + commander_<c>_*.ogg
    for u in ['archer', 'ballista', 'bat', 'crowRider', 'dwarf', 'goblin', 'hammerer', 'hordeFarmer', 'hordeBrutSpawn']:
        if u not in live:
            string_lines(u, f'assets/audio/unit_{u}_')
