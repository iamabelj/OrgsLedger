// ============================================================
// OrgsLedger API — Chunked Summarization Service
// Handles large meeting transcripts by chunking and merging
// Supports meetings with 100K+ words of transcript
// ============================================================

import { logger } from '../../logger';
import {
  chunkSpeakerTranscript,
  estimateTokens,
  type SpeakerSegment,
  type ChunkedSpeakerTranscript,
} from '../pipeline/chunking';
import { config } from '../../config';

// ── Types ─────────────────────────────────────────────────────

interface TranscriptSegment {
  speakerId?: string;
  speakerName: string;
  text: string;
  startTime: number;
  endTime: number;
  language?: string;
}

interface ChunkSummary {
  index: number;
  summary: string;
  decisions: string[];
  actionItems: Array<{
    description: string;
    assigneeName?: string;
    dueDate?: string;
    priority?: string;
  }>;
  motions: Array<{
    text: string;
    movedBy?: string;
    secondedBy?: string;
    result?: string;
  }>;
  keyPoints: string[];
  speakerTime: Record<string, number>;
}

interface MergedMinutes {
  summary: string;
  decisions: string[];
  motions: Array<{
    text: string;
    movedBy?: string;
    secondedBy?: string;
    result?: string;
  }>;
  actionItems: Array<{
    description: string;
    assigneeName?: string;
    dueDate?: string;
    priority?: string;
    status: string;
  }>;
  contributions: Array<{
    userName: string;
    speakingTimeSeconds: number;
    keyPoints: string[];
  }>;
}

// ── Constants ─────────────────────────────────────────────────

const CHUNK_MAX_TOKENS = 6000; // Leave room for prompt + response
const MERGE_MAX_TOKENS = 4000;
const SINGLE_PASS_THRESHOLD = 8000; // If under this, use single pass

// ── OpenAI Client ─────────────────────────────────────────────

let openaiClient: any = null;
function getOpenAI() {
  if (!openaiClient && config.ai.openaiApiKey) {
    const OpenAI = require('openai').default;
    openaiClient = new OpenAI({ apiKey: config.ai.openaiApiKey });
  }
  return openaiClient;
}

// ── Chunk Summary Generation ──────────────────────────────────

async function summarizeChunk(
  chunk: ChunkedSpeakerTranscript,
  meetingTitle: string,
  chunkNumber: number,
  totalChunks: number
): Promise<ChunkSummary> {
  const openai = getOpenAI();
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const transcriptText = chunk.segments
    .map((s) => `[${s.speakerName}]: ${s.text}`)
    .join('\n');

  const prompt = `You are summarizing PART ${chunkNumber} of ${totalChunks} of a meeting transcript.

Meeting: "${meetingTitle}"

Transcript Part ${chunkNumber}/${totalChunks}:
${transcriptText}

Extract from THIS SECTION ONLY:
{
  "summary": "Summary of this portion (1-2 paragraphs)",
  "decisions": ["Decisions made in this section"],
  "actionItems": [{"description": "Task", "assigneeName": "Person", "dueDate": "YYYY-MM-DD or null", "priority": "critical|high|medium|low"}],
  "motions": [{"text": "Motion", "movedBy": "Name", "secondedBy": "Name", "result": "passed|failed|tabled"}],
  "keyPoints": ["Key discussion points"],
  "speakerTime": {"Speaker Name": estimated_seconds}
}

Be concise but thorough. Only include items actually discussed in this section.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Use mini for chunks, save costs
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(content);

    return {
      index: chunk.index,
      summary: parsed.summary || '',
      decisions: parsed.decisions || [],
      actionItems: parsed.actionItems || [],
      motions: parsed.motions || [],
      keyPoints: parsed.keyPoints || [],
      speakerTime: parsed.speakerTime || {},
    };
  } catch (err) {
    logger.error(`Failed to summarize chunk ${chunkNumber}`, err);
    return {
      index: chunk.index,
      summary: `[Chunk ${chunkNumber} could not be summarized]`,
      decisions: [],
      actionItems: [],
      motions: [],
      keyPoints: [],
      speakerTime: {},
    };
  }
}

// ── Merge Chunk Summaries ─────────────────────────────────────

async function mergeChunkSummaries(
  chunkSummaries: ChunkSummary[],
  meetingTitle: string,
  meetingDescription?: string
): Promise<MergedMinutes> {
  const openai = getOpenAI();
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  // Combine all chunk data
  const combinedSummaries = chunkSummaries.map((c) => c.summary).join('\n\n---\n\n');
  const allDecisions = chunkSummaries.flatMap((c) => c.decisions);
  const allActionItems = chunkSummaries.flatMap((c) => c.actionItems);
  const allMotions = chunkSummaries.flatMap((c) => c.motions);
  const allKeyPoints = chunkSummaries.flatMap((c) => c.keyPoints);

  // Aggregate speaker time
  const speakerTotals: Record<string, { time: number; points: string[] }> = {};
  for (const chunk of chunkSummaries) {
    for (const [speaker, time] of Object.entries(chunk.speakerTime)) {
      if (!speakerTotals[speaker]) {
        speakerTotals[speaker] = { time: 0, points: [] };
      }
      speakerTotals[speaker].time += time as number;
    }
    // Associate key points with likely speakers (heuristic)
    for (const point of chunk.keyPoints) {
      // Simple heuristic: assign to most active speaker in this chunk
      const topSpeaker = Object.entries(chunk.speakerTime).sort(
        (a, b) => (b[1] as number) - (a[1] as number)
      )[0];
      if (topSpeaker && speakerTotals[topSpeaker[0]]) {
        speakerTotals[topSpeaker[0]].points.push(point);
      }
    }
  }

  const prompt = `You are a senior meeting secretary creating final meeting minutes from section summaries.

Meeting: "${meetingTitle}"
${meetingDescription ? `Description: ${meetingDescription}` : ''}

SECTION SUMMARIES:
${combinedSummaries}

COLLECTED DECISIONS:
${allDecisions.map((d, i) => `${i + 1}. ${d}`).join('\n') || 'None'}

COLLECTED ACTION ITEMS:
${allActionItems.map((a, i) => `${i + 1}. ${a.description} (${a.assigneeName || 'Unassigned'}, ${a.priority || 'medium'})`).join('\n') || 'None'}

COLLECTED MOTIONS:
${allMotions.map((m, i) => `${i + 1}. ${m.text} (${m.result || 'pending'})`).join('\n') || 'None'}

Create FINAL meeting minutes:
{
  "summary": "Executive summary of the ENTIRE meeting (3-5 paragraphs)",
  "decisions": ["De-duplicated, refined list of decisions"],
  "motions": [{"text": "Final motion text", "movedBy": "Name", "secondedBy": "Name", "result": "passed|failed|tabled"}],
  "actionItems": [{"description": "Task", "assigneeName": "Person", "dueDate": "YYYY-MM-DD or null", "priority": "critical|high|medium|low", "status": "pending"}]
}

Consolidate, de-duplicate, and refine. Remove near-duplicates. Ensure consistency.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o', // Use full model for final merge
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(content);

    // Build contributions from aggregated speaker data
    const contributions = Object.entries(speakerTotals)
      .map(([userName, data]) => ({
        userName,
        speakingTimeSeconds: data.time,
        keyPoints: data.points.slice(0, 5), // Limit to top 5 points per speaker
      }))
      .sort((a, b) => b.speakingTimeSeconds - a.speakingTimeSeconds);

    return {
      summary: parsed.summary || '',
      decisions: parsed.decisions || [],
      motions: parsed.motions || [],
      actionItems: (parsed.actionItems || []).map((item: any) => ({
        ...item,
        status: item.status || 'pending',
        priority: item.priority || 'medium',
      })),
      contributions,
    };
  } catch (err) {
    logger.error('Failed to merge chunk summaries', err);

    // Fallback: concatenate without AI merge
    return {
      summary: combinedSummaries,
      decisions: [...new Set(allDecisions)],
      motions: allMotions,
      actionItems: allActionItems.map((item) => ({
        ...item,
        status: 'pending',
        priority: item.priority || 'medium',
      })),
      contributions: Object.entries(speakerTotals).map(([userName, data]) => ({
        userName,
        speakingTimeSeconds: data.time,
        keyPoints: data.points.slice(0, 3),
      })),
    };
  }
}

// ── Main Chunked Summarization ────────────────────────────────

/**
 * Generate meeting minutes with chunking support for large transcripts.
 * Automatically chunks if transcript exceeds token threshold.
 */
export async function generateChunkedMinutes(
  transcript: TranscriptSegment[],
  meetingTitle: string,
  meetingDescription?: string
): Promise<MergedMinutes> {
  const startTime = Date.now();

  // Convert to speaker segments
  const segments: SpeakerSegment[] = transcript.map((t) => ({
    speakerName: t.speakerName,
    speakerId: t.speakerId,
    text: t.text,
    startTime: t.startTime,
    endTime: t.endTime,
  }));

  // Estimate total tokens
  const transcriptText = segments.map((s) => `[${s.speakerName}]: ${s.text}`).join('\n');
  const totalTokens = estimateTokens(transcriptText);

  logger.info('[CHUNKED_SUMMARIZATION] Starting', {
    segments: transcript.length,
    totalTokens,
    needsChunking: totalTokens > SINGLE_PASS_THRESHOLD,
  });

  // If small enough, use single pass
  if (totalTokens <= SINGLE_PASS_THRESHOLD) {
    logger.debug('[CHUNKED_SUMMARIZATION] Using single pass');
    const singleChunk: ChunkedSpeakerTranscript = {
      index: 0,
      segments,
      tokenEstimate: totalTokens,
    };

    const summary = await summarizeChunk(singleChunk, meetingTitle, 1, 1);
    
    return {
      summary: summary.summary,
      decisions: summary.decisions,
      motions: summary.motions,
      actionItems: summary.actionItems.map((item) => ({
        ...item,
        status: 'pending',
        priority: item.priority || 'medium',
      })),
      contributions: Object.entries(summary.speakerTime).map(([userName, time]) => ({
        userName,
        speakingTimeSeconds: time as number,
        keyPoints: summary.keyPoints.slice(0, 3),
      })),
    };
  }

  // Chunk the transcript
  const chunks = chunkSpeakerTranscript(segments, { maxTokens: CHUNK_MAX_TOKENS });

  logger.info('[CHUNKED_SUMMARIZATION] Chunked transcript', {
    chunkCount: chunks.length,
    avgTokensPerChunk: Math.round(totalTokens / chunks.length),
  });

  // Process chunks in parallel (batches of 3 to avoid rate limits)
  const chunkSummaries: ChunkSummary[] = [];
  const batchSize = 3;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((chunk) =>
        summarizeChunk(chunk, meetingTitle, chunk.index + 1, chunks.length)
      )
    );
    chunkSummaries.push(...batchResults);

    logger.debug(`[CHUNKED_SUMMARIZATION] Processed batch ${Math.floor(i / batchSize) + 1}`, {
      chunksProcessed: Math.min(i + batchSize, chunks.length),
      totalChunks: chunks.length,
    });
  }

  // Merge all chunk summaries
  const merged = await mergeChunkSummaries(
    chunkSummaries,
    meetingTitle,
    meetingDescription
  );

  const elapsed = Date.now() - startTime;
  logger.info('[CHUNKED_SUMMARIZATION] Complete', {
    chunks: chunks.length,
    totalTokens,
    elapsedMs: elapsed,
    decisionsFound: merged.decisions.length,
    actionItemsFound: merged.actionItems.length,
    motionsFound: merged.motions.length,
  });

  return merged;
}

/**
 * Check if transcript needs chunking.
 */
export function needsChunking(transcript: TranscriptSegment[]): boolean {
  const transcriptText = transcript
    .map((t) => `[${t.speakerName}]: ${t.text}`)
    .join('\n');
  return estimateTokens(transcriptText) > SINGLE_PASS_THRESHOLD;
}
