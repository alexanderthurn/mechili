/**
 * A small JSON Schema validator for the subset `ts-json-schema-generator`
 * emits for content types: type, properties, required, additionalProperties,
 * items (list or tuple), minItems/maxItems, enum, const, anyOf, $ref into
 * `definitions`. Deliberately not a full library — the game only validates its
 * own generated schemas, and a keyword outside this subset throws so a new
 * one can't be silently ignored.
 */
export interface JsonSchema {
    $schema?: string;
    allowComments?: boolean;
    allowTrailingCommas?: boolean;
    $ref?: string;
    definitions?: Record<string, JsonSchema>;
    description?: string;
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean | JsonSchema;
    items?: JsonSchema | JsonSchema[];
    minItems?: number;
    maxItems?: number;
    enum?: unknown[];
    const?: unknown;
    anyOf?: JsonSchema[];
}

const KNOWN = new Set([
    '$schema', '$ref', 'definitions', 'description', 'type', 'properties', 'required',
    // VS Code editor hints on the root — no effect on validation
    'allowComments', 'allowTrailingCommas',
    'additionalProperties', 'items', 'minItems', 'maxItems', 'enum', 'const', 'anyOf',
]);

function typeOf(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
    switch (t) {
        case 'object':
            return typeof v === 'object' && v !== null && !Array.isArray(v);
        case 'array':
            return Array.isArray(v);
        case 'number':
            return typeof v === 'number' && Number.isFinite(v);
        case 'integer':
            return typeof v === 'number' && Number.isInteger(v);
        case 'string':
        case 'boolean':
            return typeof v === t;
        case 'null':
            return v === null;
        default:
            throw new Error(`[schema] unsupported type "${t}"`);
    }
}

function show(v: unknown): string {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/** Validate `value` against `root`; returns human-readable problems (empty = valid). */
export function validateSchema(root: JsonSchema, value: unknown): string[] {
    const errors: string[] = [];

    const resolve = (s: JsonSchema): JsonSchema => {
        if (!s.$ref) return s;
        const m = /^#\/definitions\/(.+)$/.exec(s.$ref);
        const target = m ? root.definitions?.[decodeURIComponent(m[1]!)] : undefined;
        if (!target) throw new Error(`[schema] unresolvable $ref ${s.$ref}`);
        // a $ref sibling may only carry a description
        return resolve(target);
    };

    const walk = (schemaIn: JsonSchema, v: unknown, path: string, out: string[]): void => {
        const s = resolve(schemaIn);
        for (const node of s === schemaIn ? [s] : [schemaIn, s]) {
            for (const key of Object.keys(node)) {
                if (!KNOWN.has(key)) throw new Error(`[schema] unsupported keyword "${key}" at ${path || '(root)'}`);
            }
        }
        const at = path || '(root)';

        if (s.anyOf) {
            const attempts = s.anyOf.map((branch) => {
                const e: string[] = [];
                walk(branch, v, path, e);
                return e;
            });
            if (attempts.some((e) => e.length === 0)) return;
            const closest = attempts.reduce((a, b) => (b.length < a.length ? b : a));
            out.push(`${at}: ${show(v)} doesn't match any allowed form`);
            if (closest.length > 0 && closest.length <= 3) out.push(...closest.map((e) => `  (closest: ${e})`));
            return;
        }
        if (s.const !== undefined && v !== s.const) {
            out.push(`${at}: must be ${show(s.const)}, got ${show(v)}`);
            return;
        }
        if (s.enum && !s.enum.includes(v)) {
            out.push(`${at}: ${show(v)} is not one of ${s.enum.map(show).join(', ')}`);
            return;
        }
        if (s.type !== undefined) {
            const types = Array.isArray(s.type) ? s.type : [s.type];
            if (!types.some((t) => matchesType(v, t))) {
                out.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(v)} ${show(v)}`);
                return;
            }
        }

        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            const obj = v as Record<string, unknown>;
            const props = s.properties ?? {};
            for (const req of s.required ?? []) {
                if (!(req in obj)) out.push(`${at}: missing required field "${req}"`);
            }
            for (const [k, child] of Object.entries(obj)) {
                const childPath = path ? `${path}.${k}` : k;
                if (props[k]) {
                    walk(props[k]!, child, childPath, out);
                } else if (s.additionalProperties === false) {
                    out.push(`${at}: unknown field "${k}"`);
                } else if (typeof s.additionalProperties === 'object') {
                    walk(s.additionalProperties, child, childPath, out);
                }
            }
        }

        if (Array.isArray(v)) {
            if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: needs at least ${s.minItems} items`);
            if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at}: allows at most ${s.maxItems} items`);
            if (Array.isArray(s.items)) {
                s.items.forEach((item, i) => {
                    if (i < v.length) walk(item, v[i], `${path}[${i}]`, out);
                });
            } else if (s.items) {
                v.forEach((item, i) => walk(s.items as JsonSchema, item, `${path}[${i}]`, out));
            }
        }
    };

    walk(root, value, '', errors);
    return errors;
}
