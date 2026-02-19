export type AudioEncoding = 'WEBM_OPUS' | 'LINEAR16';
export interface SpeechSessionOptions {
    meetingId: string;
    userId: string;
    speakerName: string;
    languageCode?: string;
    encoding?: AudioEncoding;
    sampleRateHertz?: number;
    onTranscript: (text: string, isFinal: boolean) => void;
    onError?: (err: Error) => void;
}
export declare class SpeechSession {
    private client;
    private recognizeStream;
    private closed;
    private restartTimer;
    private restartCounter;
    private streamStartTime;
    private bytesSent;
    private readonly meetingId;
    private readonly userId;
    private readonly speakerName;
    private readonly languageCode;
    private readonly encoding;
    private readonly sampleRateHertz;
    private readonly onTranscript;
    private readonly onError?;
    constructor(opts: SpeechSessionOptions);
    /** Start the streaming recognition. */
    start(): void;
    /** Push an audio chunk (Buffer, ArrayBuffer, or base64 string). */
    pushAudio(data: Buffer | ArrayBuffer | string): void;
    /** Gracefully close the session. */
    close(): void;
    get isClosed(): boolean;
    private createStream;
    private restartStream;
}
//# sourceMappingURL=speech-to-text.service.d.ts.map