/** Visual layers toggled at runtime via Shift+1 … Shift+8 (Shift+0 = all on). */
export type EffectToggleId =
    | 'nearClouds'
    | 'distanceFog'
    | 'heightMist'
    | 'forestFog'
    | 'horizonClouds'
    | 'rain'
    | 'snow'
    | 'stars';

export interface EffectToggleDef {
    id: EffectToggleId;
    /** shown in console / debug overlay */
    label: string;
    /** digit key (1–8) with Shift held */
    key: number;
}

/** Order matches Shift+1 … Shift+8. */
export const EFFECT_TOGGLE_DEFS: readonly EffectToggleDef[] = [
    { id: 'nearClouds', label: 'Near clouds', key: 1 },
    { id: 'distanceFog', label: 'Distance fog', key: 2 },
    { id: 'heightMist', label: 'Height mist', key: 3 },
    { id: 'forestFog', label: 'Forest fog', key: 4 },
    { id: 'horizonClouds', label: 'Horizon clouds', key: 5 },
    { id: 'rain', label: 'Rain', key: 6 },
    { id: 'snow', label: 'Snow', key: 7 },
    { id: 'stars', label: 'Stars', key: 8 },
] as const;

export class EffectToggles {
    private readonly state: Record<EffectToggleId, boolean> = {
        nearClouds: true,
        distanceFog: true,
        heightMist: true,
        forestFog: true,
        horizonClouds: true,
        rain: true,
        snow: true,
        stars: true,
    };

    isEnabled(id: EffectToggleId): boolean {
        return this.state[id];
    }

    /** Flip one layer; returns the new on/off state. */
    toggle(id: EffectToggleId): boolean {
        this.state[id] = !this.state[id];
        return this.state[id];
    }

    setEnabled(id: EffectToggleId, on: boolean): void {
        this.state[id] = on;
    }

    resetAll(): void {
        for (const def of EFFECT_TOGGLE_DEFS) this.state[def.id] = true;
    }

    defForKey(key: number): EffectToggleDef | undefined {
        return EFFECT_TOGGLE_DEFS.find((d) => d.key === key);
    }

    debugLines(): string[] {
        return EFFECT_TOGGLE_DEFS.map(
            (d) => `fx ${d.key} ${d.label}: ${this.state[d.id] ? 'on' : 'OFF'}`,
        );
    }
}
