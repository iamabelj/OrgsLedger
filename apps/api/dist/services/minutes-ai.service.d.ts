/**
 * Structured meeting minutes output from LLM
 */
export interface StructuredMinutes {
    summary: string;
    keyTopics: string[];
    decisions: string[];
    actionItems: ActionItem[];
    participants: string[];
}
/**
 * Action item structure
 */
export interface ActionItem {
    task: string;
    owner?: string;
    deadline?: string;
}
/**
 * Transcript entry format
 */
export interface TranscriptEntry {
    speaker: string;
    speakerId?: string;
    text: string;
    timestamp: string;
    confidence?: number;
    language?: string;
}
/**
 * Generation options
 */
export interface GenerateMinutesOptions {
    meetingId: string;
    transcripts: TranscriptEntry[];
    maxTokens?: number;
    model?: string;
}
/**
 * Generation result
 */
export interface GenerationResult {
    minutes: StructuredMinutes;
    wordCount: number;
    chunksProcessed: number;
    generatedAt: string;
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
declare class MinutesAIService {
    private openai;
    private isConfigured;
    private currentPromptTokens;
    private currentCompletionTokens;
    constructor();
    /**
     * Generate structured meeting minutes from transcripts
     */
    generateMinutes(options: GenerateMinutesOptions): Promise<GenerationResult>;
    /**
     * Format transcripts into speaker-labeled text
     */
    private formatTranscripts;
    /**
     * Extract unique participants from transcripts
     */
    private extractParticipants;
    /**
     * Generate minutes in a single LLM call (for short transcripts)
     */
    private generateSinglePass;
    /**
     * Generate minutes using chunking (for long transcripts)
     */
    private generateWithChunking;
    /**
     * Split transcript into overlapping chunks
     */
    private splitIntoChunks;
    /**
     * Combine chunk summaries into final minutes
     */
    private combineChunkSummaries;
    /**
     * Manually merge chunk summaries (fallback)
     */
    private mergeChunkSummaries;
    /**
     * Call LLM API using OpenAI SDK
     */
    private callLLM;
    /**
     * Parse JSON response from LLM
     */
    private parseJSONResponse;
    /**
     * Normalize action items to consistent format
     */
    private normalizeActionItems;
    /**
     * Deduplicate array of strings
     */
    private deduplicateArray;
    /**
     * Deduplicate action items by task similarity
     */
    private deduplicateActionItems;
    /**
     * Generate fallback minutes without AI
     */
    private generateFallbackMinutes;
    /**
     * Sleep utility
     */
    private sleep;
    /**
     * Check if AI is configured
     */
    isAvailable(): boolean;
}
/**
 * Get the AI minutes service instance
 */
export declare function getMinutesAIService(): MinutesAIService;
/**
 * Generate meeting minutes using AI
 */
export declare function generateMeetingMinutes(options: GenerateMinutesOptions): Promise<GenerationResult>;
/**
 * Check if AI minutes generation is available
 */
export declare function isMinutesAIAvailable(): boolean;
export {};
//# sourceMappingURL=minutes-ai.service.d.ts.map