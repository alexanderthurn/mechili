/**
 * JSON with comments (the `.jsonc` flavour VS Code understands): `//` and
 * `/* *\/` comments plus trailing commas, on top of strict JSON.
 *
 * Comments and trailing commas are blanked out with spaces rather than removed,
 * so a JSON.parse error position still points at the right line and column of
 * the original file.
 */
export function parseJsonc(text: string, file: string): unknown {
    const chars = text.split('');
    const n = chars.length;
    let i = 0;
    const blank = (from: number, to: number) => {
        for (let k = from; k < to; k++) if (chars[k] !== '\n') chars[k] = ' ';
    };
    /** index of the next significant char at or after `k` (skips whitespace and comments) */
    const nextSignificant = (k: number): number => {
        while (k < n) {
            const c = text[k]!;
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
                k++;
            } else if (c === '/' && text[k + 1] === '/') {
                while (k < n && text[k] !== '\n') k++;
            } else if (c === '/' && text[k + 1] === '*') {
                const end = text.indexOf('*/', k + 2);
                k = end < 0 ? n : end + 2;
            } else {
                return k;
            }
        }
        return n;
    };
    while (i < n) {
        const c = text[i]!;
        if (c === '"') {
            i++;
            while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
            i++;
        } else if (c === '/' && text[i + 1] === '/') {
            const start = i;
            while (i < n && text[i] !== '\n') i++;
            blank(start, i);
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            if (end < 0) throw new Error(`${file}: unterminated /* comment at ${position(text, i)}`);
            blank(i, end + 2);
            i = end + 2;
        } else if (c === ',') {
            const next = text[nextSignificant(i + 1)];
            if (next === '}' || next === ']') chars[i] = ' ';
            i++;
        } else {
            i++;
        }
    }
    const cleaned = chars.join('');
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const at = /position (\d+)/.exec(msg);
        const where = at ? ` at ${position(text, Number(at[1]))}` : '';
        throw new Error(`${file}: invalid JSON${where} — ${msg}`);
    }
}

function position(text: string, offset: number): string {
    let line = 1;
    let col = 1;
    for (let k = 0; k < offset && k < text.length; k++) {
        if (text[k] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return `line ${line}, column ${col}`;
}
