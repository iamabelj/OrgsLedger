export interface ParticipantTokenRequest {
    meetingId: string;
    userId: string;
    name: string;
    role: 'host' | 'participant' | 'bot';
}
export interface LiveKitTokenResponse {
    token: string;
    url: string;
    roomName: string;
}
/**
 * Create a LiveKit room if it doesn't exist
 * Room name = meetingId for simplicity
 */
export declare function createRoomIfNotExists(meetingId: string): Promise<void>;
/**
 * Generate a LiveKit access token for a participant
 */
export declare function generateParticipantToken(request: ParticipantTokenRequest): Promise<LiveKitTokenResponse>;
/**
 * Delete a LiveKit room when meeting ends
 */
export declare function deleteRoom(meetingId: string): Promise<void>;
/**
 * Get list of participants in a room
 */
export declare function getRoomParticipants(meetingId: string): Promise<any[]>;
/**
 * Remove a participant from a room
 */
export declare function removeParticipant(meetingId: string, userId: string): Promise<void>;
//# sourceMappingURL=livekit-token.service.d.ts.map