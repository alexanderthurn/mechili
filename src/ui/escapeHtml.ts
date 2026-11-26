const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** Escapes a string for HTML text content or a quoted attribute value. */
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** {@link escapeHtml}, plus newlines as `&#10;` so multi-line `title` tooltips keep their breaks. */
export function escapeAttr(s: string): string {
    return escapeHtml(s).replace(/\n/g, '&#10;');
}
