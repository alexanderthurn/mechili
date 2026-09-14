/**
 * Scenario hand-over on a connection, shared by lobbies, seat reclaims and
 * spectators on every transport (plan §17). The host offers a level
 * (`levelOffer`) and answers `levelRequest`s with chunks; the joining side
 * runs a {@link LevelDownload}: restore from the scenario cache or download,
 * load, make active. A gated offer (`gate: true`) means "then send your
 * handshake again" — used where a seat or a spectator view is only handed out
 * to a peer that already plays the match's exact content.
 */
import { activeLevelRef, ensureLevel, isLevelAvailable, levelFiles, loadLevel, prepareLevel, type LevelRef } from './level';
import { LevelReceiver, LevelSender } from './levelTransfer';
import type { NetMessage } from './net';

// ------------------------------------------------------------------ host

let senderCache: { hash: string; sender: LevelSender } | null = null;

function senderFor(level: LevelRef): LevelSender | null {
    if (senderCache?.hash !== level.hash) {
        const files = levelFiles(level.hash);
        senderCache = files ? { hash: level.hash, sender: new LevelSender(files) } : null;
    }
    return senderCache?.sender ?? null;
}

/** The offer for `level` (null = base game). `gate`: the peer resends its handshake once it has it. */
export function levelOfferMessage(level: LevelRef | null, gate = false): Extract<NetMessage, { type: 'levelOffer' }> {
    return { type: 'levelOffer', level, chunks: level ? (senderFor(level)?.count ?? 0) : 0, gate };
}

/** The offer a joiner of the running match needs: the active level (the match's). */
export function matchLevelOffer(): Extract<NetMessage, { type: 'levelOffer' }> {
    return levelOfferMessage(activeLevelRef() ?? null, true);
}

/**
 * Answer a `levelRequest` for `level` with the next batch of chunks. Returns
 * true when `msg` was a level-transfer message (handled or ignored), so a
 * handshake loop can keep waiting for the real handshake.
 */
export function answerLevelMessage(
    msg: NetMessage,
    send: (m: NetMessage) => void,
    level: LevelRef | null = activeLevelRef() ?? null,
): boolean {
    if (msg.type === 'levelReady') return true;
    if (msg.type !== 'levelRequest') return false;
    const sender = level && msg.hash === level.hash ? senderFor(level) : null;
    if (!sender) return true;
    for (const index of sender.batch(msg.from)) {
        send({ type: 'levelChunk', hash: msg.hash, index, data: sender.chunk(index) });
    }
    return true;
}

// ------------------------------------------------------------------ joining side

/**
 * Makes one offered level active: nothing to do when it is loaded, restored
 * from the scenario cache when kept, else downloaded chunk by chunk over
 * `send` (feed incoming messages to {@link handle}). `done` resolves once the
 * level is active and rejects when it can't be loaded.
 */
export class LevelDownload {
    readonly done: Promise<LevelRef | null>;
    private receiver: LevelReceiver | null = null;
    private cancelled = false;
    private resolve!: (level: LevelRef | null) => void;
    private reject!: (error: unknown) => void;

    constructor(
        readonly level: LevelRef | null,
        private readonly chunks: number,
        private readonly send: (m: NetMessage) => void,
        /** called when the files have to come over the wire (e.g. to show "Loading scenario…") */
        private readonly onDownloadStart?: (level: LevelRef) => void,
    ) {
        this.done = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        void this.start();
    }

    /** stop reacting (a newer offer replaced this one) — `done` never settles */
    cancel(): void {
        this.cancelled = true;
        this.receiver = null;
    }

    private async start(): Promise<void> {
        const level = this.level;
        try {
            if (level && !isLevelAvailable(level) && !(await ensureLevel(level))) {
                if (this.cancelled) return;
                this.receiver = new LevelReceiver(level, this.chunks);
                this.onDownloadStart?.(level);
                this.send({ type: 'levelRequest', hash: level.hash, from: 0 });
                return; // continues in handle()
            }
            await this.activate(level);
        } catch (e) {
            if (!this.cancelled) this.reject(e);
        }
    }

    private async activate(level: LevelRef | null): Promise<void> {
        await prepareLevel(level ?? undefined);
        if (!this.cancelled) this.resolve(level);
    }

    /** feed a message from the host; true when it belonged to this download */
    handle(msg: NetMessage): boolean {
        if (msg.type !== 'levelChunk') return false;
        const receiver = this.receiver;
        if (this.cancelled || !receiver || receiver.level.hash !== msg.hash) return true;
        try {
            const next = receiver.add(msg.index, msg.data);
            if (next !== null) this.send({ type: 'levelRequest', hash: msg.hash, from: next });
            if (!receiver.complete()) return true;
            this.receiver = null;
            void loadLevel(receiver.level.id, receiver.files())
                .then(async ({ ref }) => {
                    if (ref.hash !== receiver.level.hash) throw new Error('the received scenario does not match the offer');
                    await this.activate(ref);
                })
                .catch((e: unknown) => {
                    if (!this.cancelled) this.reject(e);
                });
        } catch (e) {
            this.receiver = null;
            if (!this.cancelled) this.reject(e);
        }
        return true;
    }
}
