// ============================================================
// OrgsLedger — Global Meeting Context
// Persists meeting state + LiveKit connection across navigation.
// Mounted once at the root layout level.
// ============================================================

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useMeetingStore } from '../stores/meeting.store';
import { socketClient } from '../api/socket';
import { api } from '../api/client';
import { showAlert } from '../utils/alert';

// ── Types ─────────────────────────────────────────────────

export interface LiveKitJoinConfig {
  url: string;
  token: string;
  roomName: string;
  meetingType: string;
}

export interface ChatMessage {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  message: string;
  createdAt: string;
}

interface GlobalMeetingState {
  // Meeting active state
  isActive: boolean;
  isMinimized: boolean;
  meetingId: string | null;
  orgId: string | null;
  meeting: any | null;
  joinConfig: LiveKitJoinConfig | null;
  joinType: 'video' | 'audio';

  // User info (set on join)
  userId: string | null;
  userName: string;
  isAdmin: boolean;

  // Chat
  chatMessages: ChatMessage[];
  unreadChatCount: number;
  isChatOpen: boolean;

  // Audio-only mode
  isAudioOnly: boolean;

  // Elapsed timer
  elapsedSeconds: number;

  // Socket participants (live)
  liveParticipants: any[];

  // Transcripts + Minutes (refreshed periodically)
  transcripts: any[];
  transcriptsLoading: boolean;
  minutes: any | null;
  minutesLoading: boolean;
  generateLoading: boolean;

  // Recording
  isRecordingFromSocket: boolean;

  // Actions
  joinMeeting: (params: {
    orgId: string;
    meetingId: string;
    meeting: any;
    joinConfig: LiveKitJoinConfig;
    joinType: 'video' | 'audio';
    userId: string;
    userName: string;
    isAdmin: boolean;
  }) => void;
  leaveMeeting: () => void;
  endMeeting: () => void;
  minimize: () => void;
  maximize: () => void;
  toggleMinimize: () => void;
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  sendChatMessage: (message: string) => void;
  toggleAudioOnly: () => void;
  refreshTranscripts: () => void;
  refreshMinutes: () => void;
  generateMinutes: () => void;
  setMeeting: (meeting: any) => void;
  toggleAi: () => void;
}

const GlobalMeetingContext = createContext<GlobalMeetingState | null>(null);

export function useGlobalMeeting(): GlobalMeetingState {
  const ctx = useContext(GlobalMeetingContext);
  if (!ctx) throw new Error('useGlobalMeeting must be used within GlobalMeetingProvider');
  return ctx;
}

// Optional — returns null when outside provider (for conditional usage)
export function useGlobalMeetingOptional(): GlobalMeetingState | null {
  return useContext(GlobalMeetingContext);
}

// ── Provider ──────────────────────────────────────────────

export function GlobalMeetingProvider({ children }: { children: React.ReactNode }) {
  const meetingStore = useMeetingStore();

  // Core state
  const [isActive, setIsActive] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [meeting, setMeetingState] = useState<any>(null);
  const [joinConfig, setJoinConfig] = useState<LiveKitJoinConfig | null>(null);
  const [joinType, setJoinType] = useState<'video' | 'audio'>('video');

  // User
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Audio-only
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Participants
  const [liveParticipants, setLiveParticipants] = useState<any[]>([]);

  // Transcripts + Minutes
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);
  const [minutes, setMinutes] = useState<any>(null);
  const [minutesLoading, setMinutesLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);

  // Recording
  const [isRecordingFromSocket, setIsRecordingFromSocket] = useState(false);

  // Ref for isChatOpen to avoid stale closure in socket handler
  const isChatOpenRef = useRef(false);
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);

  // ── Timer ───────────────────────────────────────────────
  useEffect(() => {
    if (isActive && meeting?.status === 'live') {
      // Calculate initial elapsed from actual_start
      if (meeting.actual_start) {
        const startMs = new Date(meeting.actual_start).getTime();
        const nowMs = Date.now();
        setElapsedSeconds(Math.max(0, Math.floor((nowMs - startMs) / 1000)));
      }
      elapsedRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [isActive, meeting?.status, meeting?.actual_start]);

  // ── Socket Events ───────────────────────────────────────
  useEffect(() => {
    if (!isActive || !meetingId) return;

    const unsubs: Array<() => void> = [];

    // Participants
    unsubs.push(socketClient.on('meeting:participant-joined', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setLiveParticipants((prev) => {
        if (prev.find((p) => p.userId === data.userId)) return prev;
        return [...prev, { ...data, handRaised: false }];
      });
      meetingStore.addParticipant({ userId: data.userId, name: data.name, isModerator: data.isModerator });
    }));

    unsubs.push(socketClient.on('meeting:participant-left', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setLiveParticipants((prev) => prev.filter((p) => p.userId !== data.userId));
      meetingStore.removeParticipant(data.userId);
    }));

    unsubs.push(socketClient.on('meeting:hand-raised', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setLiveParticipants((prev) =>
        prev.map((p) => p.userId === data.userId ? { ...p, handRaised: data.raised } : p)
      );
      meetingStore.setHandRaised(data.userId, data.raised);
    }));

    // Meeting lifecycle
    unsubs.push(socketClient.on('meeting:started', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setMeetingState((prev: any) => prev ? { ...prev, status: 'live', actual_start: new Date().toISOString() } : prev);
      meetingStore.onMeetingStarted(data);
    }));

    unsubs.push(socketClient.on('meeting:ended', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setMeetingState((prev: any) => prev ? { ...prev, status: 'ended', actual_end: new Date().toISOString() } : prev);
      meetingStore.onMeetingEnded(data);
      // Don't immediately reset — keep listeners alive for minutes:ready/failed events.
      // Minimize the overlay so user can continue navigating.
      setIsMinimized(true);
      // Auto-reset after 2 minutes if minutes events don't arrive
      setTimeout(() => {
        setIsActive((active) => {
          if (active) resetMeeting();
          return false;
        });
      }, 120_000);
    }));

    unsubs.push(socketClient.on('meeting:force-disconnect', (data: any) => {
      if (data.meetingId !== meetingId) return;
      meetingStore.setMeetingEndedByModerator(true);
      meetingStore.setStatus('ended');
      // Don't immediately reset — keep listeners alive for minutes events.
      setIsMinimized(true);
      setTimeout(() => {
        setIsActive((active) => {
          if (active) resetMeeting();
          return false;
        });
      }, 120_000);
    }));

    // Recording
    unsubs.push(socketClient.on('meeting:recording-started', (data: any) => {
      if (data.meetingId === meetingId) setIsRecordingFromSocket(true);
    }));
    unsubs.push(socketClient.on('meeting:recording-stopped', (data: any) => {
      if (data.meetingId === meetingId) setIsRecordingFromSocket(false);
    }));

    // Minutes lifecycle
    unsubs.push(socketClient.on('meeting:minutes:ready', (data: any) => {
      if (data.meetingId === meetingId) {
        refreshMinutes();
        showAlert('Minutes Ready', 'AI-generated meeting minutes are now available.');
        // Meeting is done and minutes arrived — safe to clean up now
        setTimeout(() => resetMeeting(), 3000);
      }
    }));
    unsubs.push(socketClient.on('meeting:minutes:processing', (data: any) => {
      if (data.meetingId === meetingId) {
        setMinutes((prev: any) => prev ? { ...prev, status: 'processing' } : { status: 'processing' });
      }
    }));
    unsubs.push(socketClient.on('meeting:minutes:failed', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setMinutes((prev: any) => prev ? { ...prev, status: 'failed', error: data.error } : { status: 'failed', error: data.error });
      showAlert('Minutes Failed', data.error || 'AI minutes generation failed.');
      // Minutes failed — safe to clean up now
      setTimeout(() => resetMeeting(), 3000);
    }));

    // Translation errors (e.g., empty wallet)
    unsubs.push(socketClient.on('translation:error', (data: any) => {
      if (data.meetingId !== meetingId) return;
      showAlert('Translation Unavailable', data.error || 'Translation service error');
    }));

    // Real-time transcripts
    unsubs.push(socketClient.on('transcript:stored', (data: any) => {
      if (data.meetingId !== meetingId) return;
      setTranscripts((prev) => {
        const key = `${data.speakerId}-${data.timestamp}`;
        if (prev.find((t: any) => t.id === key || (t.speaker_id === data.speakerId && t.spoken_at === String(data.timestamp)))) return prev;
        return [...prev, {
          id: key,
          meeting_id: data.meetingId,
          speaker_id: data.speakerId,
          speaker_name: data.speakerName,
          original_text: data.originalText,
          source_lang: data.sourceLang,
          translations: data.translations,
          spoken_at: String(data.timestamp),
        }];
      });
    }));

    // ── Chat events ───────────────────────────────────────
    unsubs.push(socketClient.on('chat:new', (data: ChatMessage) => {
      if (data.meetingId !== meetingId) return;
      setChatMessages((prev) => {
        // Deduplicate
        if (prev.find((m) => m.id === data.id)) return prev;
        return [...prev, data];
      });
      // Increment unread if chat is closed and message is from someone else
      if (!isChatOpenRef.current && data.senderId !== userId) {
        setUnreadChatCount((c) => c + 1);
      }
    }));

    // Register history listener BEFORE requesting (avoid race condition)
    unsubs.push(socketClient.on('chat:history', (data: { messages: ChatMessage[] }) => {
      if (data.messages?.length) {
        setChatMessages(data.messages);
      }
    }));
    // Now request chat history
    socketClient.requestChatHistory(meetingId);

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [isActive, meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────

  const resetMeeting = useCallback(() => {
    setIsActive(false);
    setIsMinimized(false);
    setMeetingId(null);
    setOrgId(null);
    setMeetingState(null);
    setJoinConfig(null);
    setUserId(null);
    setUserName('');
    setIsAdmin(false);
    setChatMessages([]);
    setUnreadChatCount(0);
    setIsChatOpen(false);
    setIsAudioOnly(false);
    setElapsedSeconds(0);
    setLiveParticipants([]);
    setTranscripts([]);
    setMinutes(null);
    setIsRecordingFromSocket(false);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    meetingStore.reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const joinMeeting = useCallback((params: {
    orgId: string;
    meetingId: string;
    meeting: any;
    joinConfig: LiveKitJoinConfig;
    joinType: 'video' | 'audio';
    userId: string;
    userName: string;
    isAdmin: boolean;
  }) => {
    // If already in a meeting, leave it first
    if (isActive && meetingId) {
      socketClient.leaveMeeting(meetingId);
    }

    setOrgId(params.orgId);
    setMeetingId(params.meetingId);
    setMeetingState(params.meeting);
    setJoinConfig(params.joinConfig);
    setJoinType(params.joinType);
    setUserId(params.userId);
    setUserName(params.userName);
    setIsAdmin(params.isAdmin);
    setIsAudioOnly(params.joinType === 'audio');
    setIsActive(true);
    setIsMinimized(false);
    setChatMessages([]);
    setUnreadChatCount(0);
    setElapsedSeconds(0);
    setTranscripts([]);
    setMinutes(null);

    // Join socket room
    socketClient.joinMeeting(params.meetingId);

    // Update zustand store
    meetingStore.enterMeeting(params.meetingId, params.orgId);
    meetingStore.setMeeting(params.meeting);
    meetingStore.setJoined(true);
  }, [isActive, meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaveMeeting = useCallback(async () => {
    if (!orgId || !meetingId) return;
    try {
      await api.meetings.leave(orgId, meetingId);
    } catch {
      // Non-critical
    }
    socketClient.leaveMeeting(meetingId);
    resetMeeting();
  }, [orgId, meetingId, resetMeeting]);

  const [endingMeeting, setEndingMeeting] = useState(false);

  const endMeeting = useCallback(async () => {
    if (!orgId || !meetingId || endingMeeting) return;
    showAlert('End Meeting', 'Are you sure? All participants will be disconnected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Meeting',
        style: 'destructive',
        onPress: async () => {
          if (endingMeeting) return; // Guard against double-tap
          setEndingMeeting(true);
          try {
            await api.meetings.end(orgId, meetingId);
            // Socket handler will trigger resetMeeting
          } catch (err: any) {
            setEndingMeeting(false);
            showAlert('Error', err.response?.data?.error || 'Failed to end meeting');
          }
        },
      },
    ]);
  }, [orgId, meetingId, endingMeeting]);

  const minimize = useCallback(() => setIsMinimized(true), []);
  const maximize = useCallback(() => setIsMinimized(false), []);
  const toggleMinimize = useCallback(() => setIsMinimized((v) => !v), []);

  const toggleChat = useCallback(() => {
    setIsChatOpen((v) => {
      if (!v) setUnreadChatCount(0); // Clear unread when opening
      return !v;
    });
  }, []);

  const openChat = useCallback(() => {
    setIsChatOpen(true);
    setUnreadChatCount(0);
  }, []);

  const closeChat = useCallback(() => setIsChatOpen(false), []);

  const sendChatMessage = useCallback((message: string) => {
    if (!meetingId || !message.trim()) return;
    socketClient.sendChatMessage(meetingId, message);
  }, [meetingId]);

  const toggleAudioOnly = useCallback(() => {
    setIsAudioOnly((v) => !v);
  }, []);

  const refreshTranscripts = useCallback(async () => {
    if (!orgId || !meetingId) return;
    setTranscriptsLoading(true);
    try {
      const res = await api.meetings.getTranscripts(orgId, meetingId);
      setTranscripts(res.data.data || []);
    } catch {
      // fail silently
    } finally {
      setTranscriptsLoading(false);
    }
  }, [orgId, meetingId]);

  const refreshMinutes = useCallback(async () => {
    if (!orgId || !meetingId) return;
    setMinutesLoading(true);
    try {
      const res = await api.meetings.getMinutes(orgId, meetingId);
      setMinutes(res.data.data);
    } catch {
      setMinutes(null);
    } finally {
      setMinutesLoading(false);
    }
  }, [orgId, meetingId]);

  const generateMinutes = useCallback(async () => {
    if (!orgId || !meetingId) return;
    setGenerateLoading(true);
    try {
      await api.meetings.generateMinutes(orgId, meetingId);
      showAlert('Processing', 'AI minutes are being generated. You will be notified when ready.');
      refreshMinutes();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to generate minutes');
    } finally {
      setGenerateLoading(false);
    }
  }, [orgId, meetingId, refreshMinutes]);

  const toggleAi = useCallback(async () => {
    if (!orgId || !meetingId) return;
    try {
      const res = await api.meetings.toggleAi(orgId, meetingId);
      const newState = res.data?.data?.aiEnabled;
      setMeetingState((prev: any) => prev ? { ...prev, ai_enabled: newState } : prev);
      showAlert('AI Minutes', newState ? 'AI minutes enabled' : 'AI minutes disabled');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to toggle AI');
    }
  }, [orgId, meetingId]);

  const setMeeting = useCallback((m: any) => {
    setMeetingState(m);
    meetingStore.setMeeting(m);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value: GlobalMeetingState = {
    isActive,
    isMinimized,
    meetingId,
    orgId,
    meeting,
    joinConfig,
    joinType,
    userId,
    userName,
    isAdmin,
    chatMessages,
    unreadChatCount,
    isChatOpen,
    isAudioOnly,
    elapsedSeconds,
    liveParticipants,
    transcripts,
    transcriptsLoading,
    minutes,
    minutesLoading,
    generateLoading,
    isRecordingFromSocket,
    joinMeeting,
    leaveMeeting,
    endMeeting,
    minimize,
    maximize,
    toggleMinimize,
    toggleChat,
    openChat,
    closeChat,
    sendChatMessage,
    toggleAudioOnly,
    refreshTranscripts,
    refreshMinutes,
    generateMinutes,
    setMeeting,
    toggleAi,
  };

  return (
    <GlobalMeetingContext.Provider value={value}>
      {children}
    </GlobalMeetingContext.Provider>
  );
}
