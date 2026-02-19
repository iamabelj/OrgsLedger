"use strict";
// ============================================================
// OrgsLedger — Audio Processor
// Converts Float32 PCM audio from LiveKit into PCM16 (Int16LE)
// buffers suitable for OpenAI Realtime API.
// Buffers ~50ms frames before flushing to minimise micro-sends.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioProcessor = void 0;
const logger_1 = require("../../logger");
// ── Constants ────────────────────────────────────────────────
const SAMPLE_RATE = 24_000; // 24 kHz — OpenAI Realtime requirement
const FRAME_DURATION_MS = 50; // Target batch duration
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 1 200 samples
const BYTES_PER_SAMPLE = 2; // Int16
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE; // 2 400 bytes
class AudioProcessor {
    buffer;
    writeOffset = 0;
    onBatch;
    closed = false;
    // ── LAYER 2.2 — PCM conversion integrity tracking ───
    totalBatches = 0;
    totalBytesProcessed = 0;
    nanDetected = false;
    constructor(onBatch) {
        this.onBatch = onBatch;
        // Pre-allocate buffer for one frame
        this.buffer = Buffer.alloc(BYTES_PER_FRAME);
    }
    // ── Public API ──────────────────────────────────────────
    /**
     * Push a Float32 PCM chunk from LiveKit.
     * Converts to PCM16 and accumulates until a full ~50ms frame
     * is ready, then flushes via the callback.
     */
    pushFloat32(float32Data) {
        if (this.closed)
            return;
        const pcm16 = this.float32ToPcm16(float32Data);
        let srcOffset = 0;
        while (srcOffset < pcm16.length) {
            const remaining = BYTES_PER_FRAME - this.writeOffset;
            const toCopy = Math.min(remaining, pcm16.length - srcOffset);
            pcm16.copy(this.buffer, this.writeOffset, srcOffset, srcOffset + toCopy);
            this.writeOffset += toCopy;
            srcOffset += toCopy;
            // Flush when a full frame is accumulated
            if (this.writeOffset >= BYTES_PER_FRAME) {
                this.flush();
            }
        }
    }
    /**
     * Push raw PCM16 (Int16LE) bytes directly (e.g. if LiveKit
     * already delivers Int16 audio frames).
     */
    pushPcm16(pcm16) {
        if (this.closed)
            return;
        let srcOffset = 0;
        while (srcOffset < pcm16.length) {
            const remaining = BYTES_PER_FRAME - this.writeOffset;
            const toCopy = Math.min(remaining, pcm16.length - srcOffset);
            pcm16.copy(this.buffer, this.writeOffset, srcOffset, srcOffset + toCopy);
            this.writeOffset += toCopy;
            srcOffset += toCopy;
            if (this.writeOffset >= BYTES_PER_FRAME) {
                this.flush();
            }
        }
    }
    /**
     * Flush any remaining buffered audio (< 50ms) as a final batch.
     * Called when a track unsubscribes or session closes.
     */
    flushRemaining() {
        if (this.writeOffset > 0 && !this.closed) {
            this.flush();
        }
    }
    /** Mark processor as closed — no more audio accepted. */
    close() {
        this.flushRemaining();
        this.closed = true;
        // ── LAYER 2.2 — Final PCM integrity summary ───────
        if (this.totalBatches > 0) {
            logger_1.logger.info(`[AudioProcessor] Closed: totalBatches=${this.totalBatches}, totalBytes=${this.totalBytesProcessed}, nanDetected=${this.nanDetected}`);
        }
    }
    // ── Internals ───────────────────────────────────────────
    /** Flush the current buffer window and emit via callback. */
    flush() {
        try {
            const slice = Buffer.from(this.buffer.subarray(0, this.writeOffset));
            // ── LAYER 2.2 — Buffer size validation ───────────
            if (slice.length === 0) {
                logger_1.logger.warn('[AudioProcessor] Flush produced empty buffer — skipping');
                this.writeOffset = 0;
                return;
            }
            this.totalBatches++;
            this.totalBytesProcessed += slice.length;
            const base64 = slice.toString('base64');
            this.onBatch(base64);
        }
        catch (err) {
            logger_1.logger.warn('[AudioProcessor] Flush error', err);
        }
        // Reset write position (re-use buffer allocation)
        this.writeOffset = 0;
    }
    /**
     * Convert Float32 [-1..1] → Int16LE PCM buffer.
     * Clamps to prevent overflow artefacts.
     */
    float32ToPcm16(float32) {
        const pcm16 = Buffer.alloc(float32.length * BYTES_PER_SAMPLE);
        for (let i = 0; i < float32.length; i++) {
            // ── LAYER 2.2 — NaN detection ──────────────────
            if (Number.isNaN(float32[i])) {
                if (!this.nanDetected) {
                    logger_1.logger.error('[AudioProcessor] NaN detected in Float32 audio data — PCM conversion will produce garbage. Check LiveKit track source.');
                    this.nanDetected = true;
                }
                pcm16.writeInt16LE(0, i * BYTES_PER_SAMPLE);
                continue;
            }
            // Clamp to [-1, 1] range
            const s = Math.max(-1, Math.min(1, float32[i]));
            const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
            pcm16.writeInt16LE(Math.round(val), i * BYTES_PER_SAMPLE);
        }
        return pcm16;
    }
}
exports.AudioProcessor = AudioProcessor;
//# sourceMappingURL=audioProcessor.js.map