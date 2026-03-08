// ============================================================
// OrgsLedger API — Transcript Chunking Service
// Splits large transcripts into LLM-friendly chunks
// Preserves sentence boundaries and speaker context
// ============================================================

import { logger } from '../../logger';

// ── Constants ─────────────────────────────────────────────────

// GPT-4o context: 128K tokens, but we use conservative limits
const DEFAULT_MAX_TOKENS = 4000; // Safe limit for translation
const SUMMARIZATION_MAX_TOKENS = 8000; // Higher limit for summarization
const CHARS_PER_TOKEN = 4; // Conservative estimate (~4 chars per token)

// ── Types ─────────────────────────────────────────────────────

export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number; // Character overlap between chunks
  preserveSentences?: boolean;
  preserveSpeakers?: boolean;
}

export interface ChunkedTranscript {
  index: number;
  text: string;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
}

export interface SpeakerSegment {
  speakerName: string;
  speakerId?: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

export interface ChunkedSpeakerTranscript {
  index: number;
  segments: SpeakerSegment[];
  tokenEstimate: number;
}

// ── Sentence Boundaries ───────────────────────────────────────

const SENTENCE_ENDINGS = /([.!?]+["'»）]?\s+|\n\n+)/g;
const SENTENCE_ENDERS = new Set(['.', '!', '?']);

/**
 * Split text into sentences while preserving whitespace.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let lastIndex = 0;

  text.replace(SENTENCE_ENDINGS, (match, _p1, offset) => {
    const sentence = text.slice(lastIndex, offset + match.length);
    if (sentence.trim()) {
      sentences.push(sentence);
    }
    lastIndex = offset + match.length;
    return match;
  });

  // Capture remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) {
      sentences.push(remaining);
    }
  }

  return sentences;
}

/**
 * Estimate token count for text.
 * Uses character-based estimation (~4 chars per token for English).
 */
export function estimateTokens(text: string): number {
  // More accurate estimation considering:
  // - Punctuation (1 token each)
  // - Numbers (separate tokens)
  // - Common words (1 token)
  const charCount = text.length;
  const wordCount = text.split(/\s+/).length;

  // Weighted average: chars/4 for most text, +20% for punctuation-heavy
  const charEstimate = Math.ceil(charCount / CHARS_PER_TOKEN);
  const wordEstimate = wordCount * 1.3; // Average ~1.3 tokens per word

  return Math.ceil((charEstimate + wordEstimate) / 2);
}

// ── Main Chunking Functions ───────────────────────────────────

/**
 * Split plain text into chunks for translation.
 * Preserves sentence boundaries when possible.
 */
export function chunkTranscript(
  text: string,
  options: ChunkOptions = {}
): ChunkedTranscript[] {
  const {
    maxTokens = DEFAULT_MAX_TOKENS,
    overlap = 0,
    preserveSentences = true,
  } = options;

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const chunks: ChunkedTranscript[] = [];

  if (estimateTokens(text) <= maxTokens) {
    // Text fits in single chunk
    return [
      {
        index: 0,
        text,
        tokenEstimate: estimateTokens(text),
        startOffset: 0,
        endOffset: text.length,
      },
    ];
  }

  if (preserveSentences) {
    // Sentence-aware chunking
    const sentences = splitSentences(text);
    let currentChunk = '';
    let currentStartOffset = 0;
    let currentOffset = 0;

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence);

      // Check if adding this sentence exceeds limit
      if (estimateTokens(currentChunk + sentence) > maxTokens) {
        // Save current chunk
        if (currentChunk.trim()) {
          chunks.push({
            index: chunks.length,
            text: currentChunk.trim(),
            tokenEstimate: estimateTokens(currentChunk),
            startOffset: currentStartOffset,
            endOffset: currentOffset,
          });
        }

        // Start new chunk
        // Include overlap from end of previous chunk
        if (overlap > 0 && currentChunk.length > overlap) {
          const overlapText = currentChunk.slice(-overlap);
          currentChunk = overlapText + sentence;
          currentStartOffset = currentOffset - overlap;
        } else {
          currentChunk = sentence;
          currentStartOffset = currentOffset;
        }
      } else {
        currentChunk += sentence;
      }

      currentOffset += sentence.length;
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      chunks.push({
        index: chunks.length,
        text: currentChunk.trim(),
        tokenEstimate: estimateTokens(currentChunk),
        startOffset: currentStartOffset,
        endOffset: text.length,
      });
    }
  } else {
    // Simple character-based chunking
    let offset = 0;
    while (offset < text.length) {
      const chunkEnd = Math.min(offset + maxChars, text.length);
      const chunkText = text.slice(offset, chunkEnd);

      chunks.push({
        index: chunks.length,
        text: chunkText,
        tokenEstimate: estimateTokens(chunkText),
        startOffset: offset,
        endOffset: chunkEnd,
      });

      offset = chunkEnd - overlap;
    }
  }

  logger.debug('[CHUNKING] Text chunked', {
    originalLength: text.length,
    originalTokens: estimateTokens(text),
    chunkCount: chunks.length,
    avgChunkTokens: Math.round(
      chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length
    ),
  });

  return chunks;
}

/**
 * Chunk speaker-segmented transcript for summarization.
 * Preserves speaker boundaries and context.
 */
export function chunkSpeakerTranscript(
  segments: SpeakerSegment[],
  options: ChunkOptions = {}
): ChunkedSpeakerTranscript[] {
  const { maxTokens = SUMMARIZATION_MAX_TOKENS } = options;

  const chunks: ChunkedSpeakerTranscript[] = [];
  let currentChunk: SpeakerSegment[] = [];
  let currentTokens = 0;

  for (const segment of segments) {
    const segmentText = `[${segment.speakerName}]: ${segment.text}`;
    const segmentTokens = estimateTokens(segmentText);

    // Check if single segment exceeds limit
    if (segmentTokens > maxTokens) {
      // Split large segment
      const textChunks = chunkTranscript(segment.text, {
        maxTokens: maxTokens - 50, // Reserve tokens for speaker label
        preserveSentences: true,
      });

      for (const tc of textChunks) {
        // Save current chunk first if not empty
        if (currentChunk.length > 0) {
          chunks.push({
            index: chunks.length,
            segments: currentChunk,
            tokenEstimate: currentTokens,
          });
          currentChunk = [];
          currentTokens = 0;
        }

        // Add split segment as its own chunk
        chunks.push({
          index: chunks.length,
          segments: [
            {
              speakerName: segment.speakerName,
              speakerId: segment.speakerId,
              text: tc.text,
              startTime: segment.startTime,
              endTime: segment.endTime,
            },
          ],
          tokenEstimate: tc.tokenEstimate + 10, // Add speaker label tokens
        });
      }
      continue;
    }

    // Check if adding segment exceeds limit
    if (currentTokens + segmentTokens > maxTokens) {
      // Save current chunk
      if (currentChunk.length > 0) {
        chunks.push({
          index: chunks.length,
          segments: currentChunk,
          tokenEstimate: currentTokens,
        });
      }

      // Start new chunk
      currentChunk = [segment];
      currentTokens = segmentTokens;
    } else {
      currentChunk.push(segment);
      currentTokens += segmentTokens;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      index: chunks.length,
      segments: currentChunk,
      tokenEstimate: currentTokens,
    });
  }

  logger.debug('[CHUNKING] Speaker transcript chunked', {
    originalSegments: segments.length,
    chunkCount: chunks.length,
    totalTokens: chunks.reduce((sum, c) => sum + c.tokenEstimate, 0),
  });

  return chunks;
}

/**
 * Merge chunked summarization results.
 * Combines partial summaries into a coherent whole.
 */
export function mergeChunkSummaries(summaries: string[]): string {
  if (summaries.length === 0) return '';
  if (summaries.length === 1) return summaries[0];

  // Join with clear section breaks
  return summaries.join('\n\n---\n\n');
}

/**
 * Calculate optimal chunk size based on content characteristics.
 */
export function calculateOptimalChunkSize(
  text: string,
  targetChunks: number = 4
): number {
  const totalTokens = estimateTokens(text);
  const optimalTokens = Math.ceil(totalTokens / targetChunks);

  // Clamp to reasonable bounds
  return Math.max(1000, Math.min(optimalTokens, SUMMARIZATION_MAX_TOKENS));
}
