// ============================================================
// OrgsLedger — Audio Processor
// Converts Float32 PCM audio from LiveKit into PCM16 (Int16LE)
// buffers suitable for OpenAI Realtime API.
// Buffers ~50ms frames before flushing to minimise micro-sends.
// ============================================================

import { logger } from '../../logger';

/** Callback invoked when a buffered audio batch is ready to send. */
export type AudioBatchCallback = (pcm16Base64: string) => void;

// ── Constants ────────────────────────────────────────────────
const SAMPLE_RATE = 24_000;                  // 24 kHz — OpenAI Realtime requirement
const FRAME_DURATION_MS = 50;                // Target batch duration
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 1 200 samples
const BYTES_PER_SAMPLE = 2;                  // Int16
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE; // 2 400 bytes

export class AudioProcessor {
  private buffer: Buffer;
  private writeOffset = 0;
  private readonly onBatch: AudioBatchCallback;
  private closed = false;

  constructor(onBatch: AudioBatchCallback) {
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
  pushFloat32(float32Data: Float32Array): void {
    if (this.closed) return;

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
  pushPcm16(pcm16: Buffer): void {
    if (this.closed) return;

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
  flushRemaining(): void {
    if (this.writeOffset > 0 && !this.closed) {
      this.flush();
    }
  }

  /** Mark processor as closed — no more audio accepted. */
  close(): void {
    this.flushRemaining();
    this.closed = true;
  }

  // ── Internals ───────────────────────────────────────────

  /** Flush the current buffer window and emit via callback. */
  private flush(): void {
    try {
      const slice = Buffer.from(this.buffer.subarray(0, this.writeOffset));
      const base64 = slice.toString('base64');
      this.onBatch(base64);
    } catch (err) {
      logger.warn('[AudioProcessor] Flush error', err);
    }
    // Reset write position (re-use buffer allocation)
    this.writeOffset = 0;
  }

  /**
   * Convert Float32 [-1..1] → Int16LE PCM buffer.
   * Clamps to prevent overflow artefacts.
   */
  private float32ToPcm16(float32: Float32Array): Buffer {
    const pcm16 = Buffer.alloc(float32.length * BYTES_PER_SAMPLE);
    for (let i = 0; i < float32.length; i++) {
      // Clamp to [-1, 1] range
      const s = Math.max(-1, Math.min(1, float32[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
      pcm16.writeInt16LE(Math.round(val), i * BYTES_PER_SAMPLE);
    }
    return pcm16;
  }
}
