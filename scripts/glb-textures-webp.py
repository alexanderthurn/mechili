"""Re-encode a GLB's JPEG/PNG textures to WebP in place: same pixel size, geometry untouched."""
import sys,json,struct,io
from PIL import Image
def pad4(b,fill=b'\0'):
    return b+fill*((4-len(b)%4)%4)
for p in sys.argv[1:]:
    b=open(p,'rb').read()
    jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl])
    off=20+jl; bl=struct.unpack('<I',b[off:off+4])[0]; bin_=b[off+8:off+8+bl]
    views=[bin_[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']] for v in j['bufferViews']]
    changed=[]
    for ii,im in enumerate(j.get('images',[])):
        if im.get('mimeType') not in ('image/jpeg','image/png') or 'bufferView' not in im: continue
        data=views[im['bufferView']]
        img=Image.open(io.BytesIO(data)); size=img.size
        hasA = img.mode in ('RGBA','LA') or (img.mode=='P' and 'transparency' in img.info)
        img=img.convert('RGBA' if hasA else 'RGB')
        out=io.BytesIO(); img.save(out,'WEBP',quality=92,method=6); w=out.getvalue()
        if len(w) > len(data)*0.9: continue
        assert Image.open(io.BytesIO(w)).size==size
        views[im['bufferView']]=w
        im['mimeType']='image/webp'
        changed.append((ii,size,len(data),len(w)))
    if not changed:
        print(p,'unchanged'); continue
    webpImgs={c[0] for c in changed}
    for t in j.get('textures',[]):
        if t.get('source') in webpImgs:
            src=t.pop('source')
            t.setdefault('extensions',{})['EXT_texture_webp']={'source':src}
    for key in ('extensionsUsed','extensionsRequired'):
        lst=j.setdefault(key,[])
        if 'EXT_texture_webp' not in lst: lst.append('EXT_texture_webp')
    newbin=b''
    for i,v in enumerate(j['bufferViews']):
        newbin=pad4(newbin)
        v['byteOffset']=len(newbin)
        v['byteLength']=len(views[i])
        newbin+=views[i]
    newbin=pad4(newbin)
    j['buffers'][0]['byteLength']=len(newbin)
    js=pad4(json.dumps(j,separators=(',',':')).encode(),b' ')
    total=12+8+len(js)+8+len(newbin)
    out=struct.pack('<III',0x46546C67,2,total)+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(newbin),0x004E4942)+newbin
    open(p,'wb').write(out)
    print(p,changed,len(b),'->',len(out))
