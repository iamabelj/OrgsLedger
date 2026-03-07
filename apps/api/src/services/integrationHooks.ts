// ============================================================
// OrgsLedger — Integration Hooks
// Minimal code patches that wire the NATS event bridge and
// distributed meeting state into existing code paths.
//
// CRITICAL RULE: This file does NOT modify existing code.
// It provides wrapper functions that should be called ALONGSIDE
// existing logic. When NATS_URL is not set, every hook is a no-op.
//
// HOW TO INTEGRATE:
// 1. Import the hook you need in the relevant file
// 2. Call it alongside (not instead of) existing logic
// 3. All hooks are fire-and-forget — failures never break the monolith
//
// See INTEGRATION_GUIDE.md for exact insertion points.
// ============================================================

import { eventBridge } from './eventBridge';
import { meetingStateStore } from './meetingState';
import { metricsRegistry } from '../infrastructure/prometheusMetrics';
import { logger } from '../logger';

// ─── Meeting Lifecycle Hooks ───────────────────────────────

/**
 * Call after a user successfully joins a meeting room.
 * Insert point: socket.ts → 'meeting:join' handler, after socket.join()
 */
export async function onMeetingJoined(data: {
  meetingId: string;
  userId: string;
  name: string;
  language: string;
  organizationId: string;
}): Promise<void> {
  try {
    // 1. Mirror to distributed state store (Redis)
    await meetingStateStore.setParticipantLanguage(
      data.meetingId,
      data.userId,
      data.language,
      data.name
    );

    // 2. Publish event for standalone workers
    await eventBridge.participantJoined({
      meetingId: data.meetingId,
      userId: data.userId,
      language: data.language,
      name: data.name,
    });

    // 3. Update metrics
    metricsRegistry.meetings.activeParticipants.inc({ meeting_id: data.meetingId });
  } catch (err) {
    logger.debug('[INTEGRATION] onMeetingJoined hook failed (non-fatal)', err);
  }
}

/**
 * Call when a user leaves a meeting.
 * Insert point: socket.ts → 'meeting:leave' handler
 */
export async function onMeetingLeft(data: {
  meetingId: string;
  userId: string;
}): Promise<void> {
  try {
    await meetingStateStore.removeParticipant(data.meetingId, data.userId);
    await eventBridge.participantLeft({
      meetingId: data.meetingId,
      userId: data.userId,
    });
    metricsRegistry.meetings.activeParticipants.dec({ meeting_id: data.meetingId });
  } catch (err) {
    logger.debug('[INTEGRATION] onMeetingLeft hook failed (non-fatal)', err);
  }
}

/**
 * Call when a meeting is first created/started.
 * Insert point: meetings controller → create or start handler
 */
export async function onMeetingStarted(data: {
  meetingId: string;
  organizationId: string;
  title?: string;
}): Promise<void> {
  try {
    await meetingStateStore.setMeetingState(data.meetingId, {
      organizationId: data.organizationId,
      status: 'active',
      startedAt: new Date().toISOString(),
    });

    await eventBridge.meetingStarted({
      meetingId: data.meetingId,
      organizationId: data.organizationId,
      title: data.title,
    });

    metricsRegistry.meetings.activeMeetings.inc();
  } catch (err) {
    logger.debug('[INTEGRATION] onMeetingStarted hook failed (non-fatal)', err);
  }
}

/**
 * Call when a meeting ends.
 * Insert point: meetings controller → end meeting handler, before forceDisconnectMeeting
 */
export async function onMeetingEnded(data: {
  meetingId: string;
  organizationId: string;
  durationMs: number;
  participantCount: number;
}): Promise<void> {
  try {
    await meetingStateStore.cleanupMeeting(data.meetingId);
    await eventBridge.meetingEnded(data);
    metricsRegistry.meetings.activeMeetings.dec();
  } catch (err) {
    logger.debug('[INTEGRATION] onMeetingEnded hook failed (non-fatal)', err);
  }
}

// ─── Language Hooks ────────────────────────────────────────

/**
 * Call when a user sets/changes their translation language.
 * Insert point: socket.ts → 'translation:set-language' handler
 */
export async function onLanguageSet(data: {
  meetingId: string;
  userId: string;
  language: string;
  name: string;
}): Promise<void> {
  try {
    await meetingStateStore.setParticipantLanguage(
      data.meetingId,
      data.userId,
      data.language,
      data.name
    );
  } catch (err) {
    logger.debug('[INTEGRATION] onLanguageSet hook failed (non-fatal)', err);
  }
}

// ─── Transcription Hooks ──────────────────────────────────

/**
 * Call when a final transcript segment is ready.
 * Insert point: meetingTranscript.handler.ts → handleFinalTranscript,
 *               after translations are done
 */
export async function onTranscriptFinal(data: {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  language: string;
}): Promise<void> {
  try {
    await eventBridge.transcriptFinal({
      ...data,
      confidence: 1.0,
    });

    metricsRegistry.transcription.latency.observe(
      { meeting_id: data.meetingId },
      0 // Actual latency should be measured at call site
    );
  } catch (err) {
    logger.debug('[INTEGRATION] onTranscriptFinal hook failed (non-fatal)', err);
  }
}

/**
 * Call when an interim transcript is broadcast.
 * Insert point: meetingTranscript.handler.ts → flushInterim
 */
export async function onTranscriptInterim(data: {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  language: string;
}): Promise<void> {
  try {
    await eventBridge.transcriptInterim({
      ...data,
      confidence: 0.8,
    });
  } catch (err) {
    logger.debug('[INTEGRATION] onTranscriptInterim hook failed (non-fatal)', err);
  }
}

// ─── Translation Hooks ────────────────────────────────────

/**
 * Call after translations are completed and broadcast.
 * Insert point: processing.worker.ts → after translation and broadcast
 */
export async function onTranslationCompleted(data: {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  isFinal: boolean;
  latencyMs: number;
}): Promise<void> {
  try {
    await eventBridge.translationCompleted(data);

    metricsRegistry.translation.latency.observe(
      { source_lang: data.sourceLanguage, target_lang: 'multi' },
      data.latencyMs
    );

    if (data.isFinal) {
      // Count cache performance (estimated — actual hit/miss tracking is in translationCache.ts)
      metricsRegistry.translation.cacheHits.inc({ tier: 'event_bridge' });
    }
  } catch (err) {
    logger.debug('[INTEGRATION] onTranslationCompleted hook failed (non-fatal)', err);
  }
}

// ─── Minutes Hooks ────────────────────────────────────────

/**
 * Call when minutes generation is requested.
 * Insert point: minutes.queue.ts → addMinutesJob
 */
export async function onMinutesRequested(data: {
  meetingId: string;
  organizationId: string;
  requestedBy?: string;
}): Promise<void> {
  try {
    await eventBridge.minutesRequested(data);
  } catch (err) {
    logger.debug('[INTEGRATION] onMinutesRequested hook failed (non-fatal)', err);
  }
}

/**
 * Call when minutes are generated.
 * Insert point: minutes.worker.ts → after successful generation
 */
export async function onMinutesGenerated(data: {
  meetingId: string;
  organizationId: string;
  minutesId: string;
  summaryLength: number;
}): Promise<void> {
  try {
    await eventBridge.minutesGenerated(data);
  } catch (err) {
    logger.debug('[INTEGRATION] onMinutesGenerated hook failed (non-fatal)', err);
  }
}

// ─── HTTP Metrics Hooks ───────────────────────────────────

/**
 * Express middleware that records HTTP metrics to Prometheus.
 * Insert point: index.ts → app.use() after existing metricsMiddleware
 */
export function prometheusHttpMiddleware(req: any, res: any, next: any): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const route = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const status = String(res.statusCode);

    metricsRegistry.http.requestCount.inc({ method, route, status });
    metricsRegistry.http.requestLatency.observe({ method, route }, durationMs);
  });

  next();
}

// ─── Prometheus Metrics Endpoint ──────────────────────────

/**
 * Express route handler for /metrics (Prometheus scrape endpoint).
 * Insert point: index.ts → app.get('/metrics', prometheusMetricsHandler)
 */
export function prometheusMetricsHandler(_req: any, res: any): void {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metricsRegistry.toPrometheus());
}
