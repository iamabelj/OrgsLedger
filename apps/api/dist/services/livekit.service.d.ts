export interface LiveKitUserContext {
    id: string;
    name: string;
    email: string;
    avatar?: string;
}
export interface LiveKitTokenPayload {
    room: string;
    moderator: boolean;
    user: LiveKitUserContext;
    meetingType: 'video' | 'audio';
    features?: {
        recording?: boolean;
        transcription?: boolean;
    };
}
export interface LiveKitJoinConfig {
    url: string;
    token: string;
    roomName: string;
    meetingType: 'video' | 'audio';
    isModerator: boolean;
    userInfo: {
        displayName: string;
        email: string;
    };
}
export declare function generateRoomName(orgId: string, meetingId: string): string;
export declare function generateLiveKitToken(payload: LiveKitTokenPayload): Promise<string>;
export declare function buildJoinConfig(params: {
    meetingType: 'video' | 'audio';
    roomName: string;
    token: string;
    userName: string;
    userEmail: string;
    isModerator: boolean;
}): LiveKitJoinConfig;
//# sourceMappingURL=livekit.service.d.ts.map