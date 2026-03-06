import { TranscriptSegment } from './deepgramRealtime.service';
interface AudioBridgeConfig {
    meetingId: string;
    participantId: string;
    participantName: string;
    roomName: string;
}
interface AudioBridgeCallbacks {
    onInterimTranscript?: (segment: TranscriptSegment) => void;
    onFinalTranscript?: (segment: TranscriptSegment) => void;
    onLanguageDetected?: (language: string) => void;
    onError?: (error: Error) => void;
}
declare class LiveKitAudioBridgeService {
    private activeParticipants;
    private streamIds;
    private roomClient;
    constructor();
    /**
     * Start audio streaming for a participant
     */
    startParticipantAudioStream(config: AudioBridgeConfig, callbacks?: AudioBridgeCallbacks): Promise<string | null>;
    /**
     * Stop audio streaming for a participant
     */
    stopParticipantAudioStream(participantId: string): Promise<boolean>;
    /**
     * Send audio chunk from participant
     */
    sendAudioChunk(participantId: string, audioBuffer: Buffer): Promise<boolean>;
    /**
     * Stop all audio streams for a meeting
     */
    stopMeetingAudioStreams(meetingId: string): Promise<void>;
    /**
     * Get active participant count for a meeting
     */
    getActiveParticipantCount(meetingId: string): number;
    /**
     * Get all active participants for a meeting
     */
    getActiveMeetingParticipants(meetingId: string): Array<{
        participantId: string;
        participantName: string;
    }>;
    /**
     * Get health status
     */
    getStatus(): {
        isHealthy: boolean;
        activeParticipants: number;
        liveKitConfigured: boolean;
    };
}
export declare const liveKitAudioBridgeService: LiveKitAudioBridgeService;
export type { AudioBridgeConfig, AudioBridgeCallbacks };
//# sourceMappingURL=livekitAudioBridge.service.d.ts.map