/** Callback invoked when a buffered audio batch is ready to send. */
export type AudioBatchCallback = (pcm16Base64: string) => void;
export declare class AudioProcessor {
    private buffer;
    private writeOffset;
    private readonly onBatch;
    private closed;
    private totalBatches;
    private totalBytesProcessed;
    private nanDetected;
    constructor(onBatch: AudioBatchCallback);
    /**
     * Push a Float32 PCM chunk from LiveKit.
     * Converts to PCM16 and accumulates until a full ~50ms frame
     * is ready, then flushes via the callback.
     */
    pushFloat32(float32Data: Float32Array): void;
    /**
     * Push raw PCM16 (Int16LE) bytes directly (e.g. if LiveKit
     * already delivers Int16 audio frames).
     */
    pushPcm16(pcm16: Buffer): void;
    /**
     * Flush any remaining buffered audio (< 50ms) as a final batch.
     * Called when a track unsubscribes or session closes.
     */
    flushRemaining(): void;
    /** Mark processor as closed — no more audio accepted. */
    close(): void;
    /** Flush the current buffer window and emit via callback. */
    private flush;
    /**
     * Convert Float32 [-1..1] → Int16LE PCM buffer.
     * Clamps to prevent overflow artefacts.
     */
    private float32ToPcm16;
}
//# sourceMappingURL=audioProcessor.d.ts.map