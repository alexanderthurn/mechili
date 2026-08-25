/**
 * Bounds the error of the deterministic math in src/game/detMath.ts against the
 * engine's own Math.*. Those functions exist because ECMA-262 lets engines
 * approximate sin/cos/atan2/hypot, so the sim must not call them — but the
 * replacements still have to be *accurate*, not just reproducible. This asserts
 * they are, and prints the margin against the tolerances the sim actually uses.
 *
 *   node --experimental-strip-types scripts/check-det-math.mjs
 */
import { detAtan2, detCos, detSin } from '../src/game/detMath.ts';

/** loosest thing in the sim that a facing error could flip (TURN_ALIGN_RAD) */
const ALIGN_TOLERANCE = 0.4;
const LIMITS = { detSin: 1e-7, detCos: 1e-7, detAtan2: 1e-7 };

const worst = { detSin: 0, detCos: 0, detAtan2: 0 };
const N = 400_000;

for (let i = 0; i < N; i++) {
    const ang = (i / N) * 2 * Math.PI - Math.PI;
    worst.detSin = Math.max(worst.detSin, Math.abs(detSin(ang) - Math.sin(ang)));
    worst.detCos = Math.max(worst.detCos, Math.abs(detCos(ang) - Math.cos(ang)));
    // sweep magnitudes too: atan2 folds on the ratio, so the octant boundaries
    // and the very small / very large radii are where a fit goes wrong
    const r = [1e-4, 1, 37.5, 1e4][i & 3];
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    worst.detAtan2 = Math.max(worst.detAtan2, Math.abs(detAtan2(y, x) - Math.atan2(y, x)));
}

let failed = false;
for (const [name, err] of Object.entries(worst)) {
    const limit = LIMITS[name];
    const ok = err <= limit;
    failed ||= !ok;
    console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} max err ${err.toExponential(2)} rad` +
            ` (limit ${limit.toExponential(0)}, ${(ALIGN_TOLERANCE / err).toExponential(1)}x under the sim's align tolerance)`,
    );
}

// signed zero: stateHash mixes through a Float64 view, where -0 and +0 are
// different bit patterns, so detAtan2 normalizes them away
for (const [y, x] of [[0, 0], [-0, -0], [-0, 1], [0, -0]]) {
    if (Object.is(detAtan2(y, x), -0)) {
        console.log(`FAIL detAtan2(${y}, ${x}) returned -0`);
        failed = true;
    }
}
if (!failed) console.log('ok   signed zeros normalized');

process.exit(failed ? 1 : 0);
