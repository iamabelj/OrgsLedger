"use strict";
// ============================================================
// OrgsLedger API — AI Minutes Generation Service (Stage 5)
// Production-grade LLM-powered meeting summarization
// Uses OpenAI SDK instead of raw fetch for better error handling
// ============================================================
//
// Environment Variables:
//   OPENAI_API_KEY=sk-...
//   MINUTES_AI_MODEL=gpt-4o-mini
//   MINUTES_MAX_TOKENS=10000
//   AI_PROXY_URL=https://your-proxy.com (optional)
//   AI_PROXY_KEY=your-key (optional)
//
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMinutesAIService = getMinutesAIService;
exports.generateMeetingMinutes = generateMeetingMinutes;
exports.isMinutesAIAvailable = isMinutesAIAvailable;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const ai_cost_monitor_1 = require("../monitoring/ai-cost.monitor");
// ── Configuration ───────────────────────────────────────────
const MINUTES_CONFIG = {
    // Default model
    model: process.env.MINUTES_AI_MODEL || 'gpt-4o-mini',
    // Token limits
    maxInputTokens: parseInt(process.env.MINUTES_MAX_TOKENS || '10000', 10),
    maxOutputTokens: 2000,
    // Chunking settings
    chunkSize: 8000, // Characters per chunk (roughly 2000 tokens)
    overlapSize: 500, // Characters overlap between chunks
    // Retry settings
    maxRetries: 3,
    retryDelayMs: 1000,
    // Temperature for consistent output
    temperature: 0.3,
};
// ── LLM Prompts ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert meeting assistant that generates structured meeting minutes.

Your task is to analyze meeting transcripts and extract:
1. A concise summary (2-3 sentences)
2. Key topics discussed
3. Decisions made
4. Action items with owners and deadlines (if mentioned)
5. Participants mentioned

Rules:
- Be concise and professional
- Extract only what is explicitly mentioned
- Format action items with task, owner (if mentioned), deadline (if mentioned)
- If information is not available, return empty arrays
- Always respond with valid JSON

Output Format:
{
  "summary": "string",
  "keyTopics": ["string"],
  "decisions": ["string"],
  "actionItems": [{"task": "string", "owner": "string", "deadline": "string"}],
  "participants": ["string"]
}`;
const CHUNK_SUMMARY_PROMPT = `Summarize this portion of a meeting transcript. Extract key points, decisions, and action items.

TRANSCRIPT CHUNK:
{transcript}

Provide a JSON summary with:
{
  "chunkSummary": "string (2-3 sentences)",
  "keyPoints": ["string"],
  "decisions": ["string"],
  "actionItems": [{"task": "string", "owner": "string", "deadline": "string"}],
  "participants": ["string"]
}`;
const FINAL_SUMMARY_PROMPT = `Combine these summaries from different parts of a meeting into a single coherent meeting minutes document.

CHUNK SUMMARIES:
{summaries}

FULL PARTICIPANT LIST:
{participants}

Generate final meeting minutes with:
{
  "summary": "string (overall meeting summary, 2-3 sentences)",
  "keyTopics": ["string (main topics discussed across all chunks)"],
  "decisions": ["string (all decisions made)"],
  "actionItems": [{"task": "string", "owner": "string", "deadline": "string"}],
  "participants": ["string (unique participants)"]
}

Deduplicate similar items and ensure coherent output.`;
// ── Main Service Class ──────────────────────────────────────
class MinutesAIService {
    openai = null;
    isConfigured;
    // Token usage tracking for current generation
    currentPromptTokens = 0;
    currentCompletionTokens = 0;
    constructor() {
        // Determine API URL and key
        const apiKey = config_1.config.aiProxy?.apiKey || config_1.config.ai?.openaiApiKey || '';
        const baseURL = config_1.config.aiProxy?.url
            ? `${config_1.config.aiProxy.url}/v1`
            : undefined; // Use default OpenAI URL
        this.isConfigured = !!apiKey;
        if (this.isConfigured) {
            this.openai = new openai_1.default({
                apiKey,
                baseURL,
                maxRetries: MINUTES_CONFIG.maxRetries,
                timeout: 60000, // 60 second timeout
            });
        }
        else {
            logger_1.logger.warn('[MINUTES_AI] No API key configured — AI minutes generation disabled');
        }
    }
    /**
     * Generate structured meeting minutes from transcripts
     */
    async generateMinutes(options) {
        const { meetingId, transcripts, maxTokens, model } = options;
        const startTime = Date.now();
        // Reset token counters for this generation
        this.currentPromptTokens = 0;
        this.currentCompletionTokens = 0;
        logger_1.logger.info('[MINUTES_AI] Starting minutes generation', {
            meetingId,
            transcriptCount: transcripts.length,
            model: model || MINUTES_CONFIG.model,
        });
        if (transcripts.length === 0) {
            throw new Error('No transcripts provided for minutes generation');
        }
        // Format transcript
        const formattedTranscript = this.formatTranscripts(transcripts);
        const wordCount = formattedTranscript.split(/\s+/).length;
        logger_1.logger.info('[MINUTES_AI] Transcript formatted', {
            meetingId,
            wordCount,
            characterCount: formattedTranscript.length,
        });
        // Extract unique participants
        const participants = this.extractParticipants(transcripts);
        let minutes;
        let chunksProcessed = 1;
        // Check if chunking is needed
        const maxChars = (maxTokens || MINUTES_CONFIG.maxInputTokens) * 4; // ~4 chars per token
        if (formattedTranscript.length > maxChars) {
            logger_1.logger.info('[MINUTES_AI] Transcript exceeds token limit, using chunking', {
                meetingId,
                transcriptLength: formattedTranscript.length,
                maxChars,
            });
            const result = await this.generateWithChunking(meetingId, formattedTranscript, participants, model);
            minutes = result.minutes;
            chunksProcessed = result.chunksProcessed;
        }
        else {
            // Single-pass generation
            minutes = await this.generateSinglePass(meetingId, formattedTranscript, participants, model);
        }
        const duration = Date.now() - startTime;
        // Record token usage to AI cost monitor
        if (this.currentPromptTokens > 0 || this.currentCompletionTokens > 0) {
            try {
                (0, ai_cost_monitor_1.recordOpenAIUsage)(this.currentPromptTokens, this.currentCompletionTokens, undefined, // Use default model from config
                meetingId);
                logger_1.logger.debug('[MINUTES_AI] Token usage recorded', {
                    meetingId,
                    promptTokens: this.currentPromptTokens,
                    completionTokens: this.currentCompletionTokens,
                    totalTokens: this.currentPromptTokens + this.currentCompletionTokens,
                });
            }
            catch (err) {
                logger_1.logger.warn('[MINUTES_AI] Failed to record token usage', { error: err });
            }
        }
        logger_1.logger.info('[MINUTES_AI] Minutes generation completed', {
            meetingId,
            duration,
            chunksProcessed,
            wordCount,
            topicsCount: minutes.keyTopics.length,
            decisionsCount: minutes.decisions.length,
            actionItemsCount: minutes.actionItems.length,
            tokenUsage: {
                promptTokens: this.currentPromptTokens,
                completionTokens: this.currentCompletionTokens,
                totalTokens: this.currentPromptTokens + this.currentCompletionTokens,
            },
        });
        return {
            minutes,
            wordCount,
            chunksProcessed,
            generatedAt: new Date().toISOString(),
            tokenUsage: {
                promptTokens: this.currentPromptTokens,
                completionTokens: this.currentCompletionTokens,
                totalTokens: this.currentPromptTokens + this.currentCompletionTokens,
            },
        };
    }
    /**
     * Format transcripts into speaker-labeled text
     */
    formatTranscripts(transcripts) {
        // Sort by timestamp
        const sorted = [...transcripts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        // Format as "Speaker: Text"
        return sorted
            .map(t => `${t.speaker}: ${t.text}`)
            .join('\n');
    }
    /**
     * Extract unique participants from transcripts
     */
    extractParticipants(transcripts) {
        const speakers = new Set(transcripts.map(t => t.speaker));
        return Array.from(speakers).filter(Boolean);
    }
    /**
     * Generate minutes in a single LLM call (for short transcripts)
     */
    async generateSinglePass(meetingId, transcript, participants, model) {
        if (!this.isConfigured) {
            return this.generateFallbackMinutes(transcript, participants);
        }
        const prompt = `Analyze this meeting transcript and generate structured meeting minutes.

TRANSCRIPT:
${transcript}

KNOWN PARTICIPANTS:
${participants.join(', ')}

Generate meeting minutes as JSON.`;
        try {
            const response = await this.callLLM(prompt, model);
            const parsed = this.parseJSONResponse(response);
            // Ensure all required fields
            return {
                summary: parsed.summary || 'Meeting summary not available.',
                keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
                decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                actionItems: this.normalizeActionItems(parsed.actionItems),
                participants: Array.isArray(parsed.participants)
                    ? [...new Set([...parsed.participants, ...participants])]
                    : participants,
            };
        }
        catch (err) {
            logger_1.logger.warn('[MINUTES_AI] Single-pass generation failed, using fallback', {
                meetingId,
                error: err.message,
            });
            return this.generateFallbackMinutes(transcript, participants);
        }
    }
    /**
     * Generate minutes using chunking (for long transcripts)
     */
    async generateWithChunking(meetingId, transcript, participants, model) {
        // Split transcript into chunks
        const chunks = this.splitIntoChunks(transcript, MINUTES_CONFIG.chunkSize, MINUTES_CONFIG.overlapSize);
        logger_1.logger.info('[MINUTES_AI] Chunking transcript', {
            meetingId,
            totalChunks: chunks.length,
            chunkSize: MINUTES_CONFIG.chunkSize,
        });
        if (!this.isConfigured) {
            return {
                minutes: this.generateFallbackMinutes(transcript, participants),
                chunksProcessed: chunks.length,
            };
        }
        // Process each chunk
        const chunkSummaries = [];
        for (let i = 0; i < chunks.length; i++) {
            logger_1.logger.debug('[MINUTES_AI] Processing chunk', {
                meetingId,
                chunk: i + 1,
                totalChunks: chunks.length,
            });
            try {
                const prompt = CHUNK_SUMMARY_PROMPT.replace('{transcript}', chunks[i]);
                const response = await this.callLLM(prompt, model);
                const parsed = this.parseJSONResponse(response);
                chunkSummaries.push(parsed);
            }
            catch (err) {
                logger_1.logger.warn('[MINUTES_AI] Chunk processing failed', {
                    meetingId,
                    chunk: i + 1,
                    error: err.message,
                });
                // Continue with other chunks
            }
        }
        if (chunkSummaries.length === 0) {
            logger_1.logger.warn('[MINUTES_AI] All chunks failed, using fallback', { meetingId });
            return {
                minutes: this.generateFallbackMinutes(transcript, participants),
                chunksProcessed: chunks.length,
            };
        }
        // Combine chunk summaries
        const finalMinutes = await this.combineChunkSummaries(meetingId, chunkSummaries, participants, model);
        return {
            minutes: finalMinutes,
            chunksProcessed: chunks.length,
        };
    }
    /**
     * Split transcript into overlapping chunks
     */
    splitIntoChunks(text, chunkSize, overlap) {
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            let end = start + chunkSize;
            // Try to break at sentence boundary
            if (end < text.length) {
                const lastPeriod = text.lastIndexOf('.', end);
                const lastNewline = text.lastIndexOf('\n', end);
                const breakPoint = Math.max(lastPeriod, lastNewline);
                if (breakPoint > start + chunkSize / 2) {
                    end = breakPoint + 1;
                }
            }
            chunks.push(text.slice(start, Math.min(end, text.length)));
            start = Math.max(start + 1, end - overlap);
            // Safety check to avoid infinite loop
            if (start >= text.length || chunks.length > 100)
                break;
        }
        return chunks;
    }
    /**
     * Combine chunk summaries into final minutes
     */
    async combineChunkSummaries(meetingId, summaries, participants, model) {
        const summaryText = summaries
            .map((s, i) => `CHUNK ${i + 1}:\n${JSON.stringify(s, null, 2)}`)
            .join('\n\n');
        const prompt = FINAL_SUMMARY_PROMPT
            .replace('{summaries}', summaryText)
            .replace('{participants}', participants.join(', '));
        try {
            const response = await this.callLLM(prompt, model);
            const parsed = this.parseJSONResponse(response);
            // Merge all participants from chunks and original list
            const allParticipants = new Set(participants);
            summaries.forEach(s => {
                if (Array.isArray(s.participants)) {
                    s.participants.forEach((p) => allParticipants.add(p));
                }
            });
            return {
                summary: parsed.summary || 'Meeting summary not available.',
                keyTopics: Array.isArray(parsed.keyTopics)
                    ? this.deduplicateArray(parsed.keyTopics)
                    : [],
                decisions: Array.isArray(parsed.decisions)
                    ? this.deduplicateArray(parsed.decisions)
                    : [],
                actionItems: this.normalizeActionItems(parsed.actionItems),
                participants: Array.from(allParticipants).filter(Boolean),
            };
        }
        catch (err) {
            logger_1.logger.warn('[MINUTES_AI] Final summary failed, merging chunks manually', {
                meetingId,
                error: err.message,
            });
            return this.mergeChunkSummaries(summaries, participants);
        }
    }
    /**
     * Manually merge chunk summaries (fallback)
     */
    mergeChunkSummaries(summaries, participants) {
        const allKeyPoints = [];
        const allDecisions = [];
        const allActionItems = [];
        const allParticipants = new Set(participants);
        summaries.forEach(s => {
            if (Array.isArray(s.keyPoints))
                allKeyPoints.push(...s.keyPoints);
            if (Array.isArray(s.decisions))
                allDecisions.push(...s.decisions);
            if (Array.isArray(s.actionItems)) {
                allActionItems.push(...this.normalizeActionItems(s.actionItems));
            }
            if (Array.isArray(s.participants)) {
                s.participants.forEach((p) => allParticipants.add(p));
            }
        });
        // Create summary from chunk summaries
        const chunkSummaries = summaries
            .map(s => s.chunkSummary || s.summary)
            .filter(Boolean);
        const summary = chunkSummaries.length > 0
            ? chunkSummaries.join(' ').slice(0, 500) + '...'
            : 'Meeting summary not available.';
        return {
            summary,
            keyTopics: this.deduplicateArray(allKeyPoints).slice(0, 10),
            decisions: this.deduplicateArray(allDecisions).slice(0, 10),
            actionItems: this.deduplicateActionItems(allActionItems).slice(0, 20),
            participants: Array.from(allParticipants).filter(Boolean),
        };
    }
    /**
     * Call LLM API using OpenAI SDK
     */
    async callLLM(prompt, model) {
        const selectedModel = model || MINUTES_CONFIG.model;
        if (!this.openai) {
            throw new Error('OpenAI client not initialized');
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: selectedModel,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: prompt },
                ],
                temperature: MINUTES_CONFIG.temperature,
                max_tokens: MINUTES_CONFIG.maxOutputTokens,
                response_format: { type: 'json_object' },
            });
            // Track token usage from response
            if (response.usage) {
                this.currentPromptTokens += response.usage.prompt_tokens || 0;
                this.currentCompletionTokens += response.usage.completion_tokens || 0;
            }
            const content = response.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from LLM');
            }
            return content;
        }
        catch (err) {
            // Handle OpenAI SDK errors
            if (err instanceof openai_1.default.APIError) {
                logger_1.logger.warn('[MINUTES_AI] OpenAI API error', {
                    status: err.status,
                    message: err.message,
                    code: err.code,
                });
                throw new Error(`OpenAI API error ${err.status}: ${err.message}`);
            }
            throw err;
        }
    }
    /**
     * Parse JSON response from LLM
     */
    parseJSONResponse(response) {
        try {
            // Try direct parse
            return JSON.parse(response);
        }
        catch {
            // Try to extract JSON from markdown code blocks
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            // Try to find JSON object in response
            const objectMatch = response.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                return JSON.parse(objectMatch[0]);
            }
            throw new Error('Could not parse JSON from LLM response');
        }
    }
    /**
     * Normalize action items to consistent format
     */
    normalizeActionItems(items) {
        if (!Array.isArray(items))
            return [];
        return items.map(item => {
            if (typeof item === 'string') {
                return { task: item };
            }
            return {
                task: item.task || item.action || item.item || String(item),
                owner: item.owner || item.assignee || item.responsible || undefined,
                deadline: item.deadline || item.dueDate || item.due || undefined,
            };
        }).filter(item => item.task && item.task.length > 0);
    }
    /**
     * Deduplicate array of strings
     */
    deduplicateArray(arr) {
        const seen = new Set();
        return arr.filter(item => {
            const normalized = item.toLowerCase().trim();
            if (seen.has(normalized))
                return false;
            seen.add(normalized);
            return true;
        });
    }
    /**
     * Deduplicate action items by task similarity
     */
    deduplicateActionItems(items) {
        const seen = new Set();
        return items.filter(item => {
            const normalized = item.task.toLowerCase().trim().slice(0, 50);
            if (seen.has(normalized))
                return false;
            seen.add(normalized);
            return true;
        });
    }
    /**
     * Generate fallback minutes without AI
     */
    generateFallbackMinutes(transcript, participants) {
        const lines = transcript.split('\n');
        // Extract action items (lines with action keywords)
        const actionItems = lines
            .filter(line => /\b(will|should|need to|must|action|todo|assign)\b/i.test(line))
            .slice(0, 10)
            .map(line => ({
            task: line.replace(/^[^:]+:\s*/, '').trim(),
        }));
        // Extract decisions
        const decisions = lines
            .filter(line => /\b(decided|agree|approved|confirmed|resolved)\b/i.test(line))
            .slice(0, 10)
            .map(line => line.replace(/^[^:]+:\s*/, '').trim());
        // Count words
        const wordCount = transcript.split(/\s+/).length;
        // Generate basic summary
        const summary = `Meeting with ${participants.length} participant(s). Approximately ${wordCount} words exchanged. ${actionItems.length} potential action items identified.`;
        return {
            summary,
            keyTopics: [],
            decisions,
            actionItems,
            participants,
        };
    }
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Check if AI is configured
     */
    isAvailable() {
        return this.isConfigured;
    }
}
// ── Singleton Instance ──────────────────────────────────────
let minutesAIService = null;
/**
 * Get the AI minutes service instance
 */
function getMinutesAIService() {
    if (!minutesAIService) {
        minutesAIService = new MinutesAIService();
    }
    return minutesAIService;
}
/**
 * Generate meeting minutes using AI
 */
async function generateMeetingMinutes(options) {
    return getMinutesAIService().generateMinutes(options);
}
/**
 * Check if AI minutes generation is available
 */
function isMinutesAIAvailable() {
    return getMinutesAIService().isAvailable();
}
//# sourceMappingURL=minutes-ai.service.js.map