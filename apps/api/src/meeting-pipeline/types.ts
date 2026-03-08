// ============================================================
// OrgsLedger — Meeting Pipeline Types
// Single source of truth for all pipeline data structures
// ============================================================

/**
 * Transcript segment from Deepgram STT
 */
export interface TranscriptSegment {
  meetingId: string;
  organizationId?: string;
  speakerId?: string;
  speakerName?: string;
  text: string;
  language?: string;
  confidence?: number;
  isFinal: boolean;
  timestamp: string; // ISO string
  segmentIndex: number;
  startTime?: number; // ms offset from meeting start
  endTime?: number;
  /**
   * When true, the transcript row has already been persisted to PostgreSQL
   * by an upstream durability layer (e.g., Socket.IO safety-net).
   * Storage worker should still store the segment in Redis meeting state
   * but must skip DB insert to avoid duplicates.
   */
  alreadyPersisted?: boolean;
}

/**
 * Translation result for a transcript
 */
export interface TranslationResult {
  meetingId: string;
  segmentIndex: number;
  sourceLanguage: string;
  translations: Record<string, string>; // { "es": "Hola", "fr": "Bonjour" }
  fromCache: boolean;
  latencyMs: number;
}

/**
 * Meeting minute (generated at meeting end)
 */
export interface MeetingMinutes {
  meetingId: string;
  organizationId?: string;
  title?: string;
  summary: string;
  keyTopics: string[];
  actionItems: ActionItem[];
  decisions?: string[];
  attendees: Attendee[];
  startTime?: string;
  endTime?: string;
  duration?: number; // minutes
  generatedAt: string;
}

export interface ActionItem {
  id?: string;
  description: string;
  assignee?: string;
  dueDate?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'pending' | 'completed';
}

export interface Attendee {
  id?: string;
  userId?: string;
  name: string;
  role?: string;
  speakingTime?: number; // seconds
}

/**
 * Incremental summary (updated during meeting)
 */
export interface IncrementalSummary {
  meetingId: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  lastSegmentIndex: number;
  version: number;
  updatedAt: string;
}

/**
 * Meeting state tracked in Redis
 */
export interface MeetingState {
  meetingId: string;
  organizationId: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
  segmentCount: number;
  participantLanguages: string[]; // Languages participants want translations in
  lastSummarySegment: number;
}

/**
 * Broadcast event payload sent to WebSocket clients
 */
export interface BroadcastPayload {
  type: 'caption' | 'translation' | 'summary';
  meetingId: string;
  speakerId?: string;
  speakerName?: string;
  text?: string;
  language?: string;
  translations?: Record<string, string>;
  summary?: IncrementalSummary;
  isFinal: boolean;
  timestamp: string;
}

/**
 * Queue job types
 */
export type TranscriptJobData = TranscriptSegment;

export interface TranslationJobData {
  meetingId: string;
  organizationId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  sourceLanguage: string;
  targetLanguages: string[];
  segmentIndex: number;
  timestamp: number;
  isFinal: boolean;
}

export interface MinutesJobData {
  meetingId: string;
  organizationId: string;
}

export interface StorageJobData {
  meetingId: string;
  segment: TranscriptSegment;
}

export interface SummaryJobData {
  meetingId: string;
  organizationId: string;
  segments: TranscriptSegment[];
  currentVersion: number;
}
