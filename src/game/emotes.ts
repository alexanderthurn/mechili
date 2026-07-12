/**
 * In-match chat: emotes first, short text second. Emotes are pure data —
 * adding one is one line. Chat is NOT an action: it never touches game
 * state, so it needs no determinism, logging, or replay handling.
 */
export interface EmoteDef {
    id: string;
    icon: string;
    label: string;
}

export const EMOTES: EmoteDef[] = [
    { id: 'hello', icon: '👋', label: 'Hello' },
    { id: 'gg', icon: '🤝', label: 'Good game' },
    { id: 'lol', icon: '😂', label: 'Haha' },
    { id: 'wow', icon: '😮', label: 'Wow' },
    { id: 'cry', icon: '😭', label: 'Noo' },
    { id: 'angry', icon: '😡', label: 'Grr' },
    { id: 'think', icon: '🤔', label: 'Hmm' },
    { id: 'rocket', icon: '🚀', label: 'Incoming' },
];

export function emoteById(id: string): EmoteDef | null {
    return EMOTES.find((e) => e.id === id) ?? null;
}

export type ChatItem = { kind: 'emote'; id: string } | { kind: 'text'; text: string };

export const CHAT_TEXT_LIMIT = 120;
/** min ms between own sends (also clamped on the receiving side — P2P) */
export const CHAT_COOLDOWN_MS = 1500;
