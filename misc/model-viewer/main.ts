/**
 * Melodan model viewer: look at any .glb (game units, raw material), play its clips,
 * and pick the four the game needs (walk / fire / idle / death) into a recipe file.
 */
import {
    AmbientLight,
    AnimationClip,
    AnimationMixer,
    Box3,
    Color,
    DirectionalLight,
    GridHelper,
    Group,
    HemisphereLight,
    LoopOnce,
    LoopRepeat,
    Mesh,
    PerspectiveCamera,
    Scene,
    SkeletonHelper,
    SkinnedMesh,
    SRGBColorSpace,
    Vector3,
    VectorKeyframeTrack,
    WebGLRenderer,
    type AnimationAction,
    type Material,
    type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

type Role = 'walk' | 'fire' | 'idle' | 'death';
const ROLES: Role[] = ['walk', 'fire', 'idle', 'death'];
const ROLE_COLOR: Record<Role, string> = { walk: '#6fc36f', fire: '#e2734f', idle: '#5aa6e0', death: '#b57ad8' };

interface ModelEntry {
    path: string;
    group: string;
    size: number;
}
interface Recipe {
    model: string;
    roles: Partial<Record<Role, string>>;
    updated?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- scene (the game's theme lights: src/theme.ts) ----------
const canvas = $<HTMLCanvasElement>('view');
const main = canvas.parentElement!;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
main.appendChild(labels.domElement);

const scene = new Scene();
scene.background = new Color(0x2a3038);
scene.add(new HemisphereLight(0xe8f6cc, 0x6a9a48, 1.0));
const sun = new DirectionalLight(0xfff2c8, 2.05);
sun.position.set(40, 80, 30);
scene.add(sun, new AmbientLight(0xffffff, 0.22));
let grid = new GridHelper(10, 20, 0x56606e, 0x3a414c);
scene.add(grid);

const camera = new PerspectiveCamera(35, 1, 0.01, 2000);
camera.position.set(3, 2, 5);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

function resize(): void {
    const w = main.clientWidth;
    const h = main.clientHeight;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(main);

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

// ---------- state ----------
let models: ModelEntry[] = [];
let current: { entry: ModelEntry; scene: Object3D; clips: AnimationClip[] } | null = null;
let recipe: Recipe | null = null;
let selectedClip: string | null = null;
let rolesView = false;
let inPlace = true;
let showSkeleton = false;
let wire = false;
let paused = false;
let loop = true;
let speed = 1;

/** what is on stage: one or four rigs, each with its mixer */
interface Stage {
    root: Group;
    rigs: { obj: Object3D; mixer: AnimationMixer; action: AnimationAction | null; role?: Role }[];
    helpers: SkeletonHelper[];
}
let stage: Stage | null = null;
let modelSize = new Vector3(1, 1, 1);

// ---------- clips ----------
const inPlaceCache = new Map<AnimationClip, AnimationClip>();

/** the hips' (root bone's) travel along the ground taken out: the game moves the unit */
function stripRootMotion(clip: AnimationClip): AnimationClip {
    const hit = inPlaceCache.get(clip);
    if (hit) return hit;
    const tracks = clip.tracks.map((t) => t.clone());
    const pos =
        tracks.find((t) => /hips.*\.position$/i.test(t.name)) ??
        tracks.find((t) => t.name.endsWith('.position') && t instanceof VectorKeyframeTrack);
    if (pos) {
        const v = pos.values;
        const x0 = v[0]!;
        const z0 = v[2]!;
        for (let i = 0; i < v.length; i += 3) {
            v[i] = x0;
            v[i + 2] = z0;
        }
    }
    const out = new AnimationClip(clip.name, clip.duration, tracks);
    inPlaceCache.set(clip, out);
    return out;
}

function clipByName(name: string | undefined | null): AnimationClip | null {
    if (!current || !name) return null;
    return current.clips.find((c) => c.name === name) ?? null;
}

function playOn(rig: Stage['rigs'][number], clip: AnimationClip | null, once = false): void {
    rig.mixer.stopAllAction();
    rig.action = null;
    if (!clip) return;
    const action = rig.mixer.clipAction(inPlace ? stripRootMotion(clip) : clip);
    if (once) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
    } else action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    rig.action = action;
}

/** a role's default: a clip named exactly like it (the game's own models), else none */
function defaultRoles(clips: AnimationClip[]): Partial<Record<Role, string>> {
    const roles: Partial<Record<Role, string>> = {};
    for (const r of ROLES) {
        const hit = clips.find((c) => c.name.toLowerCase() === r);
        if (hit) roles[r] = hit.name;
    }
    return roles;
}

// ---------- stage ----------
function clearStage(): void {
    if (!stage) return;
    scene.remove(stage.root);
    for (const h of stage.helpers) scene.remove(h);
    stage.root.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
    });
    stage = null;
}

function applyLook(obj: Object3D): void {
    obj.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const mats = (Array.isArray(o.material) ? o.material : [o.material]) as Material[];
        for (const m of mats) if ('wireframe' in m) (m as Material & { wireframe: boolean }).wireframe = wire;
    });
}

function label(text: string, color: string, y: number): CSS2DObject {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = text;
    el.style.background = color;
    const obj = new CSS2DObject(el);
    obj.position.set(0, y, 0);
    return obj;
}

function buildStage(): void {
    clearStage();
    if (!current) return;
    const root = new Group();
    const rigs: Stage['rigs'] = [];
    const helpers: SkeletonHelper[] = [];
    const count = rolesView ? ROLES.length : 1;
    const gap = Math.max(modelSize.x, modelSize.z) * 1.5 + 0.2;
    for (let i = 0; i < count; i++) {
        const obj = i === 0 && !rolesView ? current.scene : cloneSkinned(current.scene);
        obj.position.set(rolesView ? (i - (count - 1) / 2) * gap : 0, 0, 0);
        root.add(obj);
        applyLook(obj);
        const rig = { obj, mixer: new AnimationMixer(obj), action: null as AnimationAction | null, role: rolesView ? ROLES[i] : undefined };
        rigs.push(rig);
        if (showSkeleton) {
            const h = new SkeletonHelper(obj);
            helpers.push(h);
            scene.add(h);
        }
        if (rolesView) {
            const role = ROLES[i]!;
            const name = recipe?.roles[role];
            obj.add(label(`${role}${name ? ' · ' + name : ' · (none)'}`, ROLE_COLOR[role], modelSize.y * 1.12 + 0.05));
            playOn(rig, clipByName(name), role === 'death');
            // death: hold the last frame a moment, then fall again
            if (role === 'death') {
                rig.mixer.addEventListener('finished', () => {
                    setTimeout(() => {
                        if (rig.action && stage?.rigs.includes(rig)) rig.action.reset().play();
                    }, 1200);
                });
            }
        }
    }
    scene.add(root);
    stage = { root, rigs, helpers };
    if (!rolesView) playOn(rigs[0]!, clipByName(selectedClip));
}

function frameCamera(): void {
    const box = new Box3().setFromObject(stage?.root ?? scene, true);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const radius = Math.max(size.length() / 2, 0.1);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
    controls.target.copy(center);
    camera.position.copy(center).add(new Vector3(0.45, 0.35, 1).normalize().multiplyScalar(dist));
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.update();
}

// ---------- loading ----------
function fmtBytes(n: number): string {
    return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB';
}

async function loadModel(entry: ModelEntry): Promise<void> {
    $('status').textContent = `Loading ${entry.path} (${fmtBytes(entry.size)}) …`;
    clearStage();
    inPlaceCache.clear();
    const gltf = await loader.loadAsync('/api/file?path=' + encodeURIComponent(entry.path));
    const wrap = new Group();
    wrap.add(gltf.scene);
    // stand it on the grid, centred
    const box = new Box3().setFromObject(gltf.scene, true);
    const c = box.getCenter(new Vector3());
    gltf.scene.position.set(-c.x, -box.min.y, -c.z);
    modelSize = box.getSize(new Vector3());
    current = { entry, scene: wrap, clips: gltf.animations };
    const saved = (await (await fetch('/api/recipe?model=' + encodeURIComponent(entry.path))).json()) as Recipe | null;
    recipe = saved ?? { model: entry.path, roles: defaultRoles(gltf.animations) };
    const urlClip = new URLSearchParams(location.hash.slice(1)).get('clip');
    selectedClip = clipByName(urlClip)?.name ?? recipe.roles.idle ?? gltf.animations[0]?.name ?? null;
    // a grid the model's size
    scene.remove(grid);
    const span = Math.max(modelSize.x, modelSize.z, modelSize.y) * 6;
    grid = new GridHelper(span, 24, 0x56606e, 0x3a414c);
    scene.add(grid);
    renderInfo(gltf.scene, entry);
    renderParts(gltf.scene);
    renderRoles();
    renderClips();
    buildStage();
    frameCamera();
    writeHash();
    $('status').textContent = entry.path;
}

function renderInfo(obj: Object3D, entry: ModelEntry): void {
    let tris = 0;
    let meshes = 0;
    let bones = 0;
    const mats = new Set<Material>();
    const tex: string[] = [];
    obj.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        meshes++;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
        if (o instanceof SkinnedMesh) bones = Math.max(bones, o.skeleton.bones.length);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (mats.has(m)) continue;
            mats.add(m);
            const map = (m as Material & { map?: { image?: { width: number; height: number } } }).map;
            if (map?.image) tex.push(`${map.image.width}²`.replace('²', `×${map.image.height}`));
        }
    });
    const rows: [string, string][] = [
        ['File', entry.path.split('/').pop()!],
        ['Size', fmtBytes(entry.size)],
        ['Triangles', Math.round(tris).toLocaleString()],
        ['Meshes', String(meshes)],
        ['Bones', String(bones || '—')],
        ['Materials', String(mats.size)],
        ['Textures', tex.join(', ') || '—'],
        ['Height', modelSize.y.toFixed(2) + ' (w ' + modelSize.x.toFixed(2) + ', d ' + modelSize.z.toFixed(2) + ')'],
        ['Clips', String(current?.clips.length ?? 0)],
    ];
    $('info').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
}

/** a file of several separate objects (e.g. a weapon set): list them, click one to see it alone */
let soloPart: string | null = null;
function renderParts(obj: Object3D): void {
    const parts: Object3D[] = [];
    obj.traverse((o) => {
        if (o instanceof Mesh && !(o instanceof SkinnedMesh)) parts.push(o);
    });
    const box = $('partsBox');
    box.hidden = parts.length < 2;
    soloPart = null;
    if (parts.length < 2) return;
    $('partCount').textContent = `(${parts.length})`;
    const el = $('parts');
    const draw = () => {
        el.innerHTML = '';
        for (const part of [null, ...parts]) {
            const row = document.createElement('div');
            const name = part ? part.name || part.parent?.name || 'part' : 'All';
            row.className = 'item' + ((part ? name : null) === soloPart ? ' on' : '');
            const g = part instanceof Mesh ? part.geometry : null;
            const tris = g ? (g.index ? g.index.count : g.attributes.position!.count) / 3 : 0;
            row.innerHTML = `<span>${name}</span><small>${part ? Math.round(tris) + ' tris' : ''}</small>`;
            row.onclick = () => {
                soloPart = part ? name : null;
                // the stage may hold clones: match by name
                stage?.root.traverse((o) => {
                    if (o instanceof Mesh && !(o instanceof SkinnedMesh)) o.visible = !soloPart || (o.name || o.parent?.name) === soloPart;
                });
                draw();
            };
            el.append(row);
        }
    };
    draw();
}

function renderRoles(): void {
    const el = $('rolelist');
    el.innerHTML = '';
    for (const r of ROLES) {
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = r;
        k.style.color = ROLE_COLOR[r];
        const v = document.createElement('span');
        const name = recipe?.roles[r];
        v.textContent = name ?? '—';
        v.style.cursor = name ? 'pointer' : '';
        if (name) v.onclick = () => selectClip(name);
        el.append(k, v);
    }
    $('recipeNote').textContent = recipe?.updated
        ? `Saved ${new Date(recipe.updated).toLocaleString()} (recipes/)`
        : 'Not saved yet — the R buttons on a clip set a role.';
}

function renderClips(): void {
    const el = $('clips');
    const q = ($('clipFilter') as HTMLInputElement).value.toLowerCase();
    el.innerHTML = '';
    const clips = current?.clips ?? [];
    $('clipCount').textContent = `(${clips.length})`;
    for (const clip of clips) {
        if (q && !clip.name.toLowerCase().includes(q)) continue;
        const row = document.createElement('div');
        row.className = 'clip' + (clip.name === selectedClip && !rolesView ? ' on' : '');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = clip.name;
        name.title = clip.name;
        const dur = document.createElement('span');
        dur.className = 'dur';
        dur.textContent = clip.duration.toFixed(2) + 's';
        const roles = document.createElement('span');
        roles.className = 'roles';
        for (const r of ROLES) {
            const b = document.createElement('b');
            b.className = r + (recipe?.roles[r] === clip.name ? ' on' : '');
            b.textContent = r[0]!.toUpperCase();
            b.title = `Use as ${r}`;
            b.onclick = (e) => {
                e.stopPropagation();
                void setRole(r, clip.name);
            };
            roles.append(b);
        }
        row.append(name, dur, roles);
        row.onclick = () => selectClip(clip.name);
        el.append(row);
    }
}

async function setRole(role: Role, clip: string): Promise<void> {
    if (!recipe || !current) return;
    if (recipe.roles[role] === clip) delete recipe.roles[role];
    else recipe.roles[role] = clip;
    recipe.updated = new Date().toISOString();
    await fetch('/api/recipe?model=' + encodeURIComponent(current.entry.path), {
        method: 'POST',
        body: JSON.stringify(recipe),
    });
    renderRoles();
    renderClips();
    if (rolesView) buildStage();
}

function selectClip(name: string): void {
    selectedClip = name;
    if (rolesView) setRolesView(false);
    else if (stage) playOn(stage.rigs[0]!, clipByName(name));
    paused = false;
    $('play').textContent = 'Pause';
    renderClips();
    writeHash();
}

function writeHash(): void {
    const p = new URLSearchParams();
    if (current) p.set('model', current.entry.path);
    if (selectedClip) p.set('clip', selectedClip);
    if (rolesView) p.set('roles', '1');
    history.replaceState(null, '', '#' + p.toString());
}

function setRolesView(on: boolean): void {
    rolesView = on;
    $('rolesView').classList.toggle('on', on);
    buildStage();
    frameCamera();
    renderClips();
    writeHash();
}

// ---------- model list ----------
function renderModels(): void {
    const q = ($('modelFilter') as HTMLInputElement).value.toLowerCase();
    const el = $('models');
    el.innerHTML = '';
    const groups = new Map<string, ModelEntry[]>();
    for (const m of models) {
        if (q && !m.path.toLowerCase().includes(q)) continue;
        if (!groups.has(m.group)) groups.set(m.group, []);
        groups.get(m.group)!.push(m);
    }
    const order = (g: string) => (g === 'Raw material' ? 0 : g === 'Finished (viewer)' ? 1 : g === 'Game units' ? 2 : 3);
    for (const [g, list] of [...groups].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))) {
        const h = document.createElement('h2');
        h.textContent = g;
        el.append(h);
        for (const m of list.sort((a, b) => a.path.localeCompare(b.path))) {
            const row = document.createElement('div');
            row.className = 'item' + (current?.entry.path === m.path ? ' on' : '');
            row.innerHTML = `<span>${m.path.split('/').pop()!.replace(/\.glb$/i, '')}</span><small>${fmtBytes(m.size)}</small>`;
            row.title = m.path;
            row.onclick = () => {
                history.replaceState(null, '', '#model=' + encodeURIComponent(m.path));
                void loadModel(m).then(renderModels);
            };
            el.append(row);
        }
    }
}

// ---------- controls ----------
$('modelFilter').oninput = renderModels;
$('clipFilter').oninput = renderClips;
$('rolesView').onclick = () => setRolesView(!rolesView);
$('inPlace').onclick = () => {
    inPlace = !inPlace;
    $('inPlace').classList.toggle('on', inPlace);
    buildStage();
};
$('skeleton').onclick = () => {
    showSkeleton = !showSkeleton;
    $('skeleton').classList.toggle('on', showSkeleton);
    buildStage();
};
$('wire').onclick = () => {
    wire = !wire;
    $('wire').classList.toggle('on', wire);
    if (stage) applyLook(stage.root);
};
$('rotate').onclick = () => {
    controls.autoRotate = !controls.autoRotate;
    $('rotate').classList.toggle('on', controls.autoRotate);
};
$('frame').onclick = frameCamera;
$('play').onclick = () => {
    paused = !paused;
    $('play').textContent = paused ? 'Play' : 'Pause';
};
$('loop').onclick = () => {
    loop = !loop;
    $('loop').classList.toggle('on', loop);
    if (!rolesView && stage) playOn(stage.rigs[0]!, clipByName(selectedClip));
};
$('speed').oninput = () => {
    speed = Number(($('speed') as HTMLInputElement).value);
    $('speedVal').textContent = speed.toFixed(2) + '×';
};
let scrubbing = false;
$('scrub').oninput = () => {
    const a = stage?.rigs[0]?.action;
    if (!a || rolesView) return;
    scrubbing = true;
    a.paused = false;
    a.time = (Number(($('scrub') as HTMLInputElement).value) / 1000) * a.getClip().duration;
    stage!.rigs[0]!.mixer.update(0);
};
$('scrub').onchange = () => (scrubbing = false);
addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
        e.preventDefault();
        $('play').click();
    }
});

// ---------- loop ----------
let last = performance.now();
function tick(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (stage && !paused && !scrubbing) for (const r of stage.rigs) r.mixer.update(dt * speed);
    const a = stage?.rigs[0]?.action;
    if (a && !rolesView) {
        const d = a.getClip().duration || 1;
        $('time').textContent = `${a.time.toFixed(2)} / ${d.toFixed(2)}s`;
        if (!scrubbing) ($('scrub') as HTMLInputElement).value = String(Math.round(((a.time % d) / d) * 1000));
    } else $('time').textContent = '';
    for (const h of stage?.helpers ?? []) h.updateMatrixWorld(true);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- start ----------
void (async () => {
    models = (await (await fetch('/api/models')).json()) as ModelEntry[];
    const p = new URLSearchParams(location.hash.slice(1));
    const want = models.find((m) => m.path === p.get('model')) ?? models.find((m) => m.group === 'Raw material');
    renderModels();
    if (want) {
        await loadModel(want);
        if (p.get('roles') === '1') setRolesView(true);
        renderModels();
    }
})();
