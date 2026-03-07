// ============================================================
// OrgsLedger — NATS Event Bridge
// Publishes domain events to NATS JetStream from existing
// code paths WITHOUT modifying existing service logic.
//
// Integration: call `eventBridge.meetingStarted(...)` alongside
// existing code — if NATS is down, the monolith continues
// working exactly as before.
// ============================================================

import { publishEvent } from '../infrastructure/natsClient';
import { logger } from '../logger';

/**
 * Event bridge — wraps NATS publishing with type-safe methods.
 * All methods are fire-and-forget: failures are logged but never
 * block or crash the caller.
 */
class EventBridge {
  private enabled: boolean;

  constructor() {
    this.enabled = !!process.env.NATS_URL;
    if (this.enabled) {
      logger.info('[EVENT_BRIDGE] NATS event bridge enabled');
    } else {
      logger.info('[EVENT_BRIDGE] NATS_URL not set — event bridge disabled (monolith mode)');
    }
  }

  // ── Meeting Lifecycle ──────────────────────────────────

  async meetingStarted(data: {
    meetingId: string;
    organizationId: string;
    title?: string;
    scheduledStart?: string;
    participants?: string[];
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent('meeting.started', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async meetingEnded(data: {
    meetingId: string;
    organizationId: string;
    durationMs: number;
    participantCount: number;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent('meeting.ended', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async participantJoined(data: {
    meetingId: string;
    userId: string;
    language: string;
    name: string;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent('meeting.participant.joined', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async participantLeft(data: {
    meetingId: string;
    userId: string;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent('meeting.participant.left', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Audio ──────────────────────────────────────────────

  async audioChunkReceived(data: {
    meetingId: string;
    participantId: string;
    chunkIndex: number;
    sampleRate: number;
    durationMs: number;
  }): Promise<void> {
    if (!this.enabled) return;
    // Use meetingId as subject suffix for partitioning
    await publishEvent(`audio.chunk.${data.meetingId}`, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Transcription ──────────────────────────────────────

  async transcriptInterim(data: {
    meetingId: string;
    speakerId: string;
    speakerName: string;
    text: string;
    language: string;
    confidence: number;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent(`transcript.interim.${data.meetingId}`, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async transcriptFinal(data: {
    meetingId: string;
    speakerId: string;
    speakerName: string;
    text: string;
    language: string;
    confidence: number;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent(`transcript.final.${data.meetingId}`, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Translation ────────────────────────────────────────

  async translationCompleted(data: {
    meetingId: string;
    speakerId: string;
    speakerName: string;
    originalText: string;
    sourceLanguage: string;
    translations: Record<string, string>;
    isFinal: boolean;
    latencyMs: number;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent(`translation.completed.${data.meetingId}`, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Minutes ────────────────────────────────────────────

  async minutesRequested(data: {
    meetingId: string;
    organizationId: string;
    requestedBy?: string;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent('minutes.requested', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async minutesGenerated(data: {
    meetingId: string;
    organizationId: string;
    minutesId: string;
    summaryLength: number;
  }): Promise<void> {
    if (!this.enabled) return;
    await publishEvent('minutes.generated', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }
}

// Export singleton
export const eventBridge = new EventBridge();
