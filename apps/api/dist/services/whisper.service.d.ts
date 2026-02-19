export declare function isWhisperAvailable(): boolean;
export declare function getWhisperDiagnostics(): {
    openaiKeyConfigured: boolean;
    openaiKeyPrefix: string;
    engine: string;
    ttsModel: string;
};
/**
 * Transcribe an audio segment using OpenAI Whisper.
 * Accepts a Buffer of complete audio (webm, mp3, wav, etc.)
 * Returns the transcript text.
 *
 * @param audioBuffer - Complete audio segment as a Buffer
 * @param options.language - ISO-639-1 hint (e.g., 'en', 'es', 'fr')
 * @param options.prompt - Previous context for better continuity
 */
export declare function transcribeAudio(audioBuffer: Buffer, options?: {
    language?: string;
    prompt?: string;
}): Promise<{
    text: string;
}>;
/**
 * Generate speech audio from text using OpenAI TTS.
 * Returns mp3 audio as a Buffer.
 *
 * @param text - Text to speak
 * @param options.voice - Voice selection (default: 'nova' — warm, natural)
 * @param options.speed - Playback speed 0.25–4.0 (default: 1.0)
 */
export declare function generateTTSAudio(text: string, options?: {
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    speed?: number;
}): Promise<Buffer>;
//# sourceMappingURL=whisper.service.d.ts.map