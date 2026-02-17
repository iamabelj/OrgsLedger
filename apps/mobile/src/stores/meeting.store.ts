// ============================================================
// OrgsLedger — Centralized Meeting Store (Zustand)
// All meeting state derived from WebSocket events.
// No component-local state for meeting status.
// ============================================================

import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────

export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

export interface MeetingParticipant {
  userId: string;
  name: string;
  isModerator?: boolean;
  handRaised?: boolean;
  language?: string;
}

export interface TranslationEntry {
  id: string;
  speakerName: string;
  speakerId: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

export interface MeetingState {
  // ── Core ─────────────────────────────────────
  meetingId: string | null;
  orgId: string | null;
  meeting: any | null;
  status: MeetingStatus | null;
  isJoined: boolean;

  // ── Participants ─────────────────────────────
  participants: MeetingParticipant[];

  // ── Translation ──────────────────────────────
  myLanguage: string;
  translations: TranslationEntry[];
  interimText: string;
  translationParticipants: Array<{ userId: string; name: string; language: string }>;

  // ── Moderator controls ───────────────────────
  isRecording: boolean;
  isLocked: boolean;

  // ── Meeting ended overlay ────────────────────
  meetingEndedByModerator: boolean;

  // ── Actions ──────────────────────────────────
  setMeeting: (meeting: any) => void;
  setStatus: (status: MeetingStatus) => void;
  setJoined: (joined: boolean) => void;

  // Participant management
  addParticipant: (p: MeetingParticipant) => void;
  removeParticipant: (userId: string) => void;
  setHandRaised: (userId: string, raised: boolean) => void;
  setParticipants: (participants: MeetingParticipant[]) => void;

  // Translation
  setMyLanguage: (lang: string) => void;
  addTranslation: (entry: TranslationEntry) => void;
  setInterimText: (text: string) => void;
  setTranslationParticipants: (participants: Array<{ userId: string; name: string; language: string }>) => void;
  clearTranslations: () => void;

  // Moderator broadcast
  setRecording: (recording: boolean) => void;
  setLocked: (locked: boolean) => void;

  // Meeting lifecycle
  onMeetingStarted: (data: { meetingId: string; title?: string; status: string }) => void;
  onMeetingEnded: (data: { meetingId: string; title?: string; status: string }) => void;
  setMeetingEndedByModerator: (ended: boolean) => void;

  // Reset
  enterMeeting: (meetingId: string, orgId: string) => void;
  leaveMeeting: () => void;
  reset: () => void;
}

const INITIAL_STATE = {
  meetingId: null as string | null,
  orgId: null as string | null,
  meeting: null as any | null,
  status: null as MeetingStatus | null,
  isJoined: false,
  participants: [] as MeetingParticipant[],
  myLanguage: 'en',
  translations: [] as TranslationEntry[],
  interimText: '',
  translationParticipants: [] as Array<{ userId: string; name: string; language: string }>,
  isRecording: false,
  isLocked: false,
  meetingEndedByModerator: false,
};

export const useMeetingStore = create<MeetingState>((set, get) => ({
  ...INITIAL_STATE,

  // ── Core ─────────────────────────────────────

  setMeeting: (meeting) => set({
    meeting,
    status: meeting?.status || null,
  }),

  setStatus: (status) => set((state) => ({
    status,
    meeting: state.meeting ? { ...state.meeting, status } : state.meeting,
  })),

  setJoined: (isJoined) => set({ isJoined }),

  // ── Participants ─────────────────────────────

  addParticipant: (p) => set((state) => {
    if (state.participants.find((x) => x.userId === p.userId)) return state;
    return { participants: [...state.participants, { ...p, handRaised: false }] };
  }),

  removeParticipant: (userId) => set((state) => ({
    participants: state.participants.filter((p) => p.userId !== userId),
  })),

  setHandRaised: (userId, raised) => set((state) => ({
    participants: state.participants.map((p) =>
      p.userId === userId ? { ...p, handRaised: raised } : p
    ),
  })),

  setParticipants: (participants) => set({ participants }),

  // ── Translation ──────────────────────────────

  setMyLanguage: (myLanguage) => set({ myLanguage }),

  addTranslation: (entry) => set((state) => ({
    translations: [...state.translations, entry].slice(-100),
    interimText: '',
  })),

  setInterimText: (interimText) => set({ interimText }),

  setTranslationParticipants: (translationParticipants) => set({ translationParticipants }),

  clearTranslations: () => set({ translations: [], interimText: '' }),

  // ── Moderator controls ───────────────────────

  setRecording: (isRecording) => set({ isRecording }),
  setLocked: (isLocked) => set({ isLocked }),

  // ── Meeting lifecycle ────────────────────────

  onMeetingStarted: (data) => {
    const { meetingId } = get();
    if (data.meetingId === meetingId) {
      set((state) => ({
        status: 'live',
        meeting: state.meeting
          ? { ...state.meeting, status: 'live', actual_start: new Date().toISOString() }
          : state.meeting,
      }));
    }
  },

  onMeetingEnded: (data) => {
    const { meetingId } = get();
    if (data.meetingId === meetingId) {
      set((state) => ({
        status: 'ended',
        meetingEndedByModerator: true,
        meeting: state.meeting
          ? { ...state.meeting, status: 'ended', actual_end: new Date().toISOString() }
          : state.meeting,
      }));
    }
  },

  setMeetingEndedByModerator: (meetingEndedByModerator) => set({ meetingEndedByModerator }),

  // ── Room management ──────────────────────────

  enterMeeting: (meetingId, orgId) => set({
    ...INITIAL_STATE,
    meetingId,
    orgId,
  }),

  leaveMeeting: () => set({
    isJoined: false,
    participants: [],
    translations: [],
    interimText: '',
    translationParticipants: [],
    meetingEndedByModerator: false,
  }),

  reset: () => set(INITIAL_STATE),
}));
