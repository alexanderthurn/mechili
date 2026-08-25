/**
 * The commander, standing on his own keep.
 *
 * Shown only when the Stronghold is a lifeline — the mode where losing the
 * keep loses the army. That is the whole reason he is up there: the thing the
 * siege is actually for is a person, and you can see him from across the
 * board. In the other modes the keep is just a building and nobody is home.
 *
 * Visual only. Nothing here is ever read by the sim, so nothing here can move
 * a state hash.
 */
import { Box3, Group, Vector3, type Object3D, type Scene } from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { SpecialityId } from './cards';
import { commanderModelFor, ensureCommanderTemplate, getCommanderTemplate } from './commanderModels';
import { worldHeightAt } from './map';
import type { SeatId } from './seats';
import { attackNodeWorld, getUnitSlotLocal } from './unitModels';
import type { Unit } from './units';

/** which authored battlement spot he takes — `Unit5` on stronghold.glb */
const COMMANDER_SLOT = 5;
/**
 * World height of the figure. The keep stands 21 (model 5.0 × meshScale 4.2)
 * and a wizard 6.4. Five read as a giant looming off the wall-walk; 3.5 sits
 * him in scale with the masonry he is standing on.
 */
const COMMANDER_HEIGHT = 3.5;

const _anchor = new Vector3();
const _size = new Vector3();

/**
 * Where an authored `UnitN` spot is in the world right now. Prefers the live
 * node inside the placed mesh (exact, and follows anything the mesh is doing);
 * falls back to the baked local offset transformed by the unit's own pose,
 * which is what instanced keeps have.
 */
export function strongholdSlotWorld(
    unit: Unit,
    slot: number,
): { x: number; y: number; z: number } | null {
    const member = unit.members[0];
    if (member && !member.mesh.userData.dead) {
        member.mesh.updateWorldMatrix(true, false);
        const live = member.mesh.getObjectByName(`Unit${slot}`);
        if (live) {
            live.getWorldPosition(_anchor);
            return { x: _anchor.x, y: _anchor.y, z: _anchor.z };
        }
    }
    const local = getUnitSlotLocal(unit.type.id, slot);
    if (!local) return null;
    const footY = worldHeightAt(unit.world.x, unit.world.z) + unit.memberBaseY();
    return attackNodeWorld(
        local,
        unit.world.x,
        footY,
        unit.world.z,
        unit.facing,
        unit.visualMeshScale(),
    );
}

type Standing = {
    view: Group;
    /** which figure is currently built — rebuild only when this changes */
    modelId: SpecialityId;
};

export class StrongholdCommanders {
    private readonly standing = new Map<number, Standing>();
    /** kicked once per figure so a pending load does not re-request every frame */
    private readonly requested = new Set<SpecialityId>();

    constructor(private readonly scene: Scene) {}

    /**
     * `keeps` are the living Strongholds; `specialityOf` gives each seat's own
     * chosen card. Call every frame — the work is a map walk unless something
     * actually changed.
     */
    sync(
        keeps: readonly Unit[],
        specialityOf: (seat: SeatId) => SpecialityId | null,
        enabled: boolean,
    ): void {
        if (!enabled) {
            this.clear();
            return;
        }

        const seen = new Set<number>();
        for (const keep of keeps) {
            if (keep.destroyed) continue;
            const anchor = strongholdSlotWorld(keep, COMMANDER_SLOT);
            if (!anchor) continue;

            const modelId = commanderModelFor(specialityOf(keep.seat));
            const template = getCommanderTemplate(modelId);
            if (!template) {
                // not downloaded yet — ask once, and pick it up on a later frame
                if (!this.requested.has(modelId)) {
                    this.requested.add(modelId);
                    void ensureCommanderTemplate(modelId);
                }
                continue;
            }

            seen.add(keep.id);
            let stand = this.standing.get(keep.id);
            if (stand && stand.modelId !== modelId) {
                this.retire(keep.id);
                stand = undefined;
            }
            if (!stand) {
                stand = { view: this.build(template), modelId };
                this.scene.add(stand.view);
                this.standing.set(keep.id, stand);
            }
            stand.view.position.set(anchor.x, anchor.y, anchor.z);
            // the model's own forward is the keep's backward, so turn him
            // around: he ends up looking out the way his keep does
            stand.view.rotation.y = keep.facing + Math.PI;
        }

        for (const id of [...this.standing.keys()]) {
            if (!seen.has(id)) this.retire(id);
        }
    }

    /** Scale the unit-height template to {@link COMMANDER_HEIGHT}. */
    private build(template: Group): Group {
        const view = new Group();
        const model = skeletonClone(template) as Object3D;
        model.traverse((o) => {
            const mesh = o as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
            if (mesh.isMesh) {
                // No shadow, and no rule of his own to reason about. He stands
                // on whichever side of the keep his slot is on, which is often
                // the side the sun is behind — a cast shadow there lands on
                // masonry that is already dark, so it bought nothing but a
                // special case.
                mesh.castShadow = false;
                mesh.receiveShadow = true;
            }
        });
        // the template is normalized to 1, but measure rather than assume —
        // a re-exported GLB with a different longest axis would otherwise
        // arrive at some other size with no clue why
        new Box3().setFromObject(model).getSize(_size);
        const tall = _size.y > 1e-3 ? _size.y : 1;
        model.scale.setScalar(COMMANDER_HEIGHT / tall);
        view.add(model);
        return view;
    }

    private retire(keepId: number): void {
        const stand = this.standing.get(keepId);
        if (!stand) return;
        this.scene.remove(stand.view);
        this.standing.delete(keepId);
    }

    clear(): void {
        for (const id of [...this.standing.keys()]) this.retire(id);
    }

    dispose(): void {
        this.clear();
    }
}
