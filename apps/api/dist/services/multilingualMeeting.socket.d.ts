import { Socket, Server } from 'socket.io';
/**
 * Register multilingual meeting transcript handlers
 * Call this function in socket.ts after Socket.IO setup
 *
 * @param io Socket.IO server instance
 * @param socket Individual socket connection
 */
export declare function registerMultilingualMeetingHandlers(io: Server, socket: Socket): void;
/**
 * Integration function to retrieve transcript stats for a meeting
 * Useful for admin panels and meeting dashboards
 */
export declare function getMeetingTranscriptStats(meetingId: string): Promise<{
    activeStreams: number;
    totalTranscripts: number;
    languages: Array<{
        language: string;
        count: number;
    }>;
    status: 'healthy' | 'degraded' | 'offline';
}>;
/**
 * Generate meeting minutes from accumulated transcripts
 * Call this after meeting ends or on demand
 * Integrates with existing AIService
 */
export declare function generateMeetingMinutesFromTranscripts(meetingId: string): Promise<boolean>;
/**
 * Export useful utility types and helpers
 */
export type { MeetingTranscriptContext } from './meetingTranscript.handler';
//# sourceMappingURL=multilingualMeeting.socket.d.ts.map