/**
 * Cross-engine deterministic math for the lockstep simulation.
 *
 * ECMA-262 requires `Math.sqrt` to be correctly rounded, but explicitly permits
 * implementations to *approximate* `sin`, `cos`, `atan2`, `hypot`, `pow`, `exp`
 * and `log`. Two conformant engines may therefore disagree in the last place,
 * which is all it takes: peers exchange actions and compare a state hash built
 * over `Float64` bits, so one ulp anywhere on the sim path becomes a completely
 * different fingerprint and a "Desync detected".
 *
 * Everything here is built from `+ - * /`, comparisons and `Math.sqrt` — the
 * operations IEEE-754 pins down exactly — so every peer computes identical bits
 * on every engine and platform.
 *
 * Use these anywhere a value reaches the sim. Render-only code (mesh yaw,
 * particle offsets, camera work) can keep the native functions: it is faster,
 * and nobody hashes a bob height.
 */

/** Deterministic `Math.hypot`. */
export function hypot(x: number, y: number, z = 0): number {
    return Math.sqrt(x * x + y * y + z * z);
}

/** Wrap to (−π, π]. `Math.floor` is exact, so this is too. */
function wrapPi(a: number): number {
    const twoPi = Math.PI * 2;
    return a - twoPi * Math.floor((a + Math.PI) / twoPi);
}

/**
 * Deterministic `Math.sin` — range-reduced Taylor series to x^11, which
 * converges tightly once the argument is folded into [−π/2, π/2].
 */
export function detSin(a: number): number {
    let x = wrapPi(a);
    // fold into [-π/2, π/2], where the series below converges tightly
    if (x > Math.PI / 2) x = Math.PI - x;
    else if (x < -Math.PI / 2) x = -Math.PI - x;
    const x2 = x * x;
    return (
        x *
        (1 +
            x2 *
                (-1 / 6 +
                    x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 - x2 / 39916800)))))
    );
}

/** Deterministic `Math.cos`. */
export function detCos(a: number): number {
    return detSin(a + Math.PI / 2);
}

/**
 * `atan` on [−1, 1] — odd polynomial, Chebyshev-fitted. Only used via
 * {@link detAtan2}, which folds every input into that interval first.
 */
function atanUnit(x: number): number {
    const z = x * x;
    return (
        x *
        (0.9999993329 +
            z *
                (-0.3332985605 +
                    z *
                        (0.1994653599 +
                            z *
                                (-0.1390853351 +
                                    z *
                                        (0.0964200441 +
                                            z * (-0.0559098861 + z * (0.0218612288 + z * -0.004054058)))))))
    );
}

/**
 * Deterministic `Math.atan2`. Max absolute error vs the native function is
 * 3.8e-8 rad (2.2e-6°) — see `scripts/check-det-math.mjs`. For scale, the sim's
 * own alignment tolerance is 0.4 rad and a facing feeds movement over ranges
 * under 40 units, so the error is seven orders of magnitude below anything that
 * can change a decision.
 *
 * Deliberately returns `+0` rather than the native `-0` for the degenerate and
 * negative-zero cases. `stateHash` mixes through a `Float64` view where `-0` and
 * `+0` are *different bit patterns*, so normalizing the sign here removes a
 * second, quieter way for two peers to hash the same angle differently.
 */
export function detAtan2(y: number, x: number): number {
    if (x === 0 && y === 0) return 0;
    const ax = x < 0 ? -x : x;
    const ay = y < 0 ? -y : y;
    // fold to the first octant: atan(1/t) = π/2 − atan(t) keeps the ratio ≤ 1
    let a = ay <= ax ? atanUnit(ay / ax) : Math.PI / 2 - atanUnit(ax / ay);
    if (x < 0) a = Math.PI - a;
    const r = y < 0 ? -a : a;
    // -0 and +0 are different bit patterns to stateHash's Float64 view
    return r === 0 ? 0 : r;
}
