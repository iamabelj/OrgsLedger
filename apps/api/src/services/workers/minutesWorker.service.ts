// ============================================================
// OrgsLedger API — Minutes Worker Service
// Core business logic for processing AI meeting minutes
// Handles transcription, summarization, and wallet deduction
// ============================================================

import { logger } from '../../logger';
import { AIService } from '../ai.service';

interface TranscriptSegment {
  speakerId?: string;
  speakerName: string;
  text: string;
  startTime: number;
  endTime: number;
  language?: string;
}

interface ProcessedMinutes {
  transcript: TranscriptSegment[];
  summary: string;
  decisions: string[];
  motions: Array<{
    text: string;
    movedBy?: string;
    secondedBy?: string;
    result?: string;
  }>;
  actionItems: Array<{
    description: string;
    assigneeName?: string;
    dueDate?: string;
    priority?: string;
    status: string;
  }>;
  contributions: Array<{
    userName: string;
    speakingTimeSeconds: number;
    keyPoints: string[];
  }>;
}

/**
 * Service that processes AI minutes generation jobs from the queue
 */
export class MinutesWorkerService {
  private io: any;
  private aiService: AIService;

  constructor(io?: any) {
    this.io = io;
    this.aiService = new AIService(io);
  }

  /**
   * Process a minutes generation job
   * Handles transcription, summarization, storage, and notifications
   */
  async processMinutes(
    meetingId: string,
    organizationId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('[MINUTES_WORKER] Delegating to AI service pipeline', {
        meetingId,
        organizationId,
      });

      await this.aiService.processMinutes(meetingId, organizationId);

      return { success: true };
    } catch (err: any) {
      logger.error('[MINUTES_WORKER] Processing failed', {
        meetingId,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Emit error event
      if (this.io) {
        this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:failed', {
          meetingId,
          error: 'Minutes generation failed. Please try again later.',
        });
      }

      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
