"""Re-encode a GLB's WebP textures to PNG in place and drop EXT_texture_webp (see glb-plain.mjs)."""
import sys, json, struct, io
from PIL import Image
def pad4(b, fill=b'\0'):
    return b + fill * ((4 - len(b) % 4) % 4)
for p in sys.argv[1:]:
    b = open(p, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl])
    off = 20 + jl; bl = struct.unpack('<I', b[off:off + 4])[0]; bin_ = b[off + 8:off + 8 + bl]
    views = [bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in j.get('bufferViews', [])]
    n = 0
    for im in j.get('images', []):
        if im.get('mimeType') != 'image/webp' or 'bufferView' not in im: continue
        img = Image.open(io.BytesIO(views[im['bufferView']]))
        img = img.convert('RGBA' if img.mode in ('RGBA', 'LA', 'P') and 'A' in img.getbands() or img.mode == 'RGBA' else 'RGB')
        out = io.BytesIO(); img.save(out, 'PNG', optimize=True)
        views[im['bufferView']] = out.getvalue(); im['mimeType'] = 'image/png'; n += 1
    for t in j.get('textures', []):
        ext = t.get('extensions', {})
        if 'EXT_texture_webp' in ext:
            t['source'] = ext.pop('EXT_texture_webp')['source']
            if not ext: t.pop('extensions')
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in j:
            j[key] = [e for e in j[key] if e != 'EXT_texture_webp']
            if not j[key]: j.pop(key)
    if not views:
        print(p, 'no buffer views'); continue
    newbin = b''
    for i, v in enumerate(j['bufferViews']):
        newbin = pad4(newbin); v['byteOffset'] = len(newbin); v['byteLength'] = len(views[i]); newbin += views[i]
    newbin = pad4(newbin); j['buffers'][0]['byteLength'] = len(newbin)
    js = pad4(json.dumps(j, separators=(',', ':')).encode(), b' ')
    total = 12 + 8 + len(js) + 8 + len(newbin)
    open(p, 'wb').write(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(newbin), 0x004E4942) + newbin)
    print(f'{p.split("/")[-1]}: {n} textures -> PNG')
