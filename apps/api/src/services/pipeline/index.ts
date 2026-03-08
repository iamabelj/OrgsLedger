// ============================================================
// OrgsLedger API — Pipeline Service Exports
// Centralized exports for the AI meeting pipeline
// Architecture: Fan-out from transcript-events to 5 queues
// ============================================================

// Fan-Out Orchestrator (NEW - Primary entry point)
export {
  fanOutOrchestrator,
  initializeFanOutOrchestrator,
  getFanOutOrchestrator,
} from './fanOutOrchestrator';

// Legacy orchestrator (for backward compatibility)
export {
  pipelineOrchestrator,
  type PipelineStage,
  type PipelineEvent,
  type TranscriptInput,
  type TranslationOutput,
} from './orchestrator';

export {
  chunkTranscript,
  chunkSpeakerTranscript,
  estimateTokens,
  mergeChunkSummaries,
  calculateOptimalChunkSize,
  type ChunkOptions,
  type ChunkedTranscript,
  type ChunkedSpeakerTranscript,
  type SpeakerSegment,
} from './chunking';

export {
  pipelineMetrics,
  type MetricsBucket,
  type PipelineMetricsSnapshot,
} from './metrics';

export {
  generateChunkedMinutes,
  needsChunking,
} from './chunkedSummarization';
