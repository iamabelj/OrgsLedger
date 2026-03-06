"use strict";
// ============================================================
// OrgsLedger API — Deepgram Realtime STT Service
// High-accuracy multilingual streaming speech-to-text
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepgramRealtimeService = void 0;
const sdk_1 = require("@deepgram/sdk");
const logger_1 = require("../logger");
class DeepgramRealtimeService {
    client;
    activeStreams = new Map();
    streamConfigs = new Map();
    streamCallbacks = new Map();
    constructor() {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
            logger_1.logger.warn('DEEPGRAM_API_KEY not configured - STT will be unavailable');
        }
        // DeepgramClient automatically uses DEEPGRAM_API_KEY env var if no options provided
        this.client = apiKey ? new sdk_1.DeepgramClient({ apiKey }) : new sdk_1.DeepgramClient();
    }
    /**
     * Create a new Deepgram streaming connection for a speaker
     */
    async createStream(streamId, config, callbacks) {
        try {
            if (!process.env.DEEPGRAM_API_KEY) {
                logger_1.logger.warn('Deepgram not configured, streaming STT unavailable');
                return false;
            }
            // Store config and callbacks
            this.streamConfigs.set(streamId, config);
            if (callbacks) {
                this.streamCallbacks.set(streamId, callbacks);
            }
            // Create live transcription connection
            const connection = await this.client.listen.v1.connect({
                model: 'nova-3',
                language: 'multi',
                punctuate: true,
                smart_format: true,
                diarize: true,
                interim_results: true,
                endpointing: 300,
                utterance_end_ms: 3000,
            }); // Type assertion needed due to SDK type definitions
            // Handle transcription events
            connection.on('open', () => {
                logger_1.logger.info(`Deepgram stream opened: ${streamId}`, {
                    meetingId: config.meetingId,
                    speakerId: config.speakerId,
                });
            });
            connection.on('message', (data) => {
                if (data.type === 'Results') {
                    this.handleTranscript(streamId, data);
                }
            });
            connection.on('error', (error) => {
                logger_1.logger.error(`Deepgram stream error: ${streamId}`, error);
                const callbacks = this.streamCallbacks.get(streamId);
                if (callbacks?.onError) {
                    callbacks.onError(error);
                }
            });
            connection.on('close', () => {
                logger_1.logger.info(`Deepgram stream closed: ${streamId}`);
                this.activeStreams.delete(streamId);
                this.streamConfigs.delete(streamId);
                this.streamCallbacks.delete(streamId);
            });
            // Connect and wait for the connection to open
            connection.connect();
            await connection.waitForOpen();
            // Store the connection
            this.activeStreams.set(streamId, connection);
            return true;
        }
        catch (err) {
            logger_1.logger.error(`Failed to create Deepgram stream: ${streamId}`, err);
            return false;
        }
    }
    /**
     * Send audio chunk to Deepgram stream
     */
    async handleAudioChunk(streamId, audioData) {
        try {
            const stream = this.activeStreams.get(streamId);
            if (!stream) {
                logger_1.logger.warn(`Stream not found: ${streamId}`);
                return false;
            }
            // Send audio data to Deepgram via WebSocket
            stream.socket.send(audioData);
            return true;
        }
        catch (err) {
            logger_1.logger.error(`Failed to send audio chunk to stream: ${streamId}`, err);
            return false;
        }
    }
    /**
     * Close a streaming connection
     */
    async closeStream(streamId) {
        try {
            const stream = this.activeStreams.get(streamId);
            if (!stream) {
                return true; // Already closed
            }
            // Finalize the stream
            stream.finalize();
            return true;
        }
        catch (err) {
            logger_1.logger.error(`Failed to close stream: ${streamId}`, err);
            return false;
        }
    }
    /**
     * Close all active streams for a meeting
     */
    async closeMeetingStreams(meetingId) {
        try {
            for (const [streamId, config] of this.streamConfigs.entries()) {
                if (config.meetingId === meetingId) {
                    await this.closeStream(streamId);
                }
            }
            logger_1.logger.info(`Closed all streams for meeting: ${meetingId}`);
        }
        catch (err) {
            logger_1.logger.error(`Failed to close meeting streams: ${meetingId}`, err);
        }
    }
    /**
     * Handle transcript response from Deepgram
     */
    handleTranscript(streamId, data) {
        const config = this.streamConfigs.get(streamId);
        const callbacks = this.streamCallbacks.get(streamId);
        if (!config) {
            logger_1.logger.warn(`Config not found for stream: ${streamId}`);
            return;
        }
        try {
            // Extract transcript from Deepgram response
            const transcript = data.channel?.alternatives?.[0];
            if (!transcript) {
                return;
            }
            const text = transcript.transcript || '';
            const confidence = transcript.confidence || 0;
            const isFinal = !data.is_final === false; // Invert to get boolean
            const language = this.extractLanguage(data);
            // Extract speaker information if diarization is enabled
            const speakers = this.extractSpeakers(data);
            // Emit language detection if available
            if (language && callbacks?.onLanguageDetected) {
                callbacks.onLanguageDetected(language);
            }
            // Create transcript segment
            const segment = {
                speakerId: config.speakerId,
                speakerName: config.speakerName,
                text,
                language: language || 'en',
                isFinal,
                confidence,
                timestamp: new Date(),
                speakers,
            };
            // Emit appropriate callback
            if (isFinal && callbacks?.onFinal) {
                callbacks.onFinal(segment);
            }
            else if (!isFinal && callbacks?.onInterim) {
                callbacks.onInterim(segment);
            }
        }
        catch (err) {
            logger_1.logger.error(`Error handling transcript for stream: ${streamId}`, err);
        }
    }
    /**
     * Extract detected language from Deepgram response
     */
    extractLanguage(data) {
        // Language detection result is at: results[0].languages or metadata
        const languages = data.result?.languages || [];
        if (languages.length > 0) {
            return languages[0].language || null;
        }
        return null;
    }
    /**
     * Extract speaker information from diarization
     */
    extractSpeakers(data) {
        const words = data.channel?.alternatives?.[0]?.words || [];
        const speakers = words
            .filter((w) => w.speaker !== undefined)
            .map((w) => ({
            speakerId: w.speaker,
            confidence: w.confidence,
        }));
        return speakers.length > 0 ? speakers : undefined;
    }
    /**
     * Get active stream count
     */
    getActiveStreamCount() {
        return this.activeStreams.size;
    }
    /**
     * Get health status
     */
    getStatus() {
        return {
            isHealthy: true,
            activeStreams: this.activeStreams.size,
            configured: !!process.env.DEEPGRAM_API_KEY,
        };
    }
}
// Export singleton instance
exports.deepgramRealtimeService = new DeepgramRealtimeService();
//# sourceMappingURL=deepgramRealtime.service.js.map