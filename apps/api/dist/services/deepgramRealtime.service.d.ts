interface DeepgramStreamConfig {
    meetingId: string;
    speakerId: string;
    speakerName: string;
}
interface TranscriptSegment {
    speakerId: string;
    speakerName: string;
    text: string;
    language: string;
    isFinal: boolean;
    confidence: number;
    timestamp: Date;
    speakers?: Array<{
        speakerId: number;
        confidence: number;
    }>;
}
interface StreamCallbacks {
    onInterim?: (segment: TranscriptSegment) => void;
    onFinal?: (segment: TranscriptSegment) => void;
    onError?: (error: Error) => void;
    onLanguageDetected?: (language: string) => void;
}
declare class DeepgramRealtimeService {
    private client;
    private activeStreams;
    private streamConfigs;
    private streamCallbacks;
    constructor();
    /**
     * Create a new Deepgram streaming connection for a speaker
     */
    createStream(streamId: string, config: DeepgramStreamConfig, callbacks?: StreamCallbacks): Promise<boolean>;
    /**
     * Send audio chunk to Deepgram stream
     */
    handleAudioChunk(streamId: string, audioData: Buffer): Promise<boolean>;
    /**
     * Close a streaming connection
     */
    closeStream(streamId: string): Promise<boolean>;
    /**
     * Close all active streams for a meeting
     */
    closeMeetingStreams(meetingId: string): Promise<void>;
    /**
     * Handle transcript response from Deepgram
     */
    private handleTranscript;
    /**
     * Extract detected language from Deepgram response
     */
    private extractLanguage;
    /**
     * Extract speaker information from diarization
     */
    private extractSpeakers;
    /**
     * Get active stream count
     */
    getActiveStreamCount(): number;
    /**
     * Get health status
     */
    getStatus(): {
        isHealthy: boolean;
        activeStreams: number;
        configured: boolean;
    };
}
export declare const deepgramRealtimeService: DeepgramRealtimeService;
export type { TranscriptSegment, StreamCallbacks, DeepgramStreamConfig };
//# sourceMappingURL=deepgramRealtime.service.d.ts.map