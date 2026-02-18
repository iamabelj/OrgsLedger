// ============================================================
// OrgsLedger Mobile — Socket.io Client
// Event-driven real-time layer with reconnection,
// meeting state sync, and room auto-rejoin.
// ============================================================

import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import storage from '../utils/storage';

function getSocketUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return window.location.origin; // same-origin — works for localhost AND production
  }
  if (__DEV__) return 'http://localhost:3000';
  return 'https://app.orgsledger.com';
}

const SOCKET_URL = getSocketUrl();

class SocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private activeMeetingId: string | null = null;

  async connect(): Promise<void> {
    const token = await storage.getItemAsync('accessToken');
    if (!token) return;

    // Prevent duplicate connections
    if (this.socket?.connected) return;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
    });

    this.socket.on('connect', () => {
      // Re-join active meeting room on reconnect
      if (this.activeMeetingId) {
        this.socket?.emit('meeting:join', this.activeMeetingId);
      }
    });

    this.socket.on('disconnect', (reason) => {
      // If server disconnected us (e.g. meeting:force-disconnect),
      // don't auto-rejoin — the server did it deliberately
      if (reason === 'io server disconnect') {
        this.activeMeetingId = null;
      }
    });

    this.socket.on('connect_error', (_err) => {
      // Reconnection is handled automatically
    });

    // Re-attach persistent listeners
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((cb) => {
        this.socket?.on(event, cb as any);
      });
    });
  }

  disconnect(): void {
    this.activeMeetingId = null;
    this.socket?.disconnect();
    this.socket = null;
  }

  /**
   * Subscribe to a socket event. Returns unsubscribe function.
   * Listeners persist across reconnections.
   */
  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    this.socket?.on(event, callback as any);

    return () => {
      this.listeners.get(event)?.delete(callback);
      this.socket?.off(event, callback as any);
    };
  }

  emit(event: string, data?: any): void {
    this.socket?.emit(event, data);
  }

  // ── Channel Methods ─────────────────────────────────────

  joinChannel(channelId: string): void {
    this.socket?.emit('channel:join', channelId);
  }

  leaveChannel(channelId: string): void {
    this.socket?.emit('channel:leave', channelId);
  }

  sendTyping(channelId: string): void {
    this.socket?.emit('channel:typing', { channelId });
  }

  stopTyping(channelId: string): void {
    this.socket?.emit('channel:stop-typing', { channelId });
  }

  markChannelRead(channelId: string): void {
    this.socket?.emit('channel:read', { channelId });
  }

  // ── Meeting Methods ─────────────────────────────────────

  joinMeeting(meetingId: string): void {
    this.activeMeetingId = meetingId;
    this.socket?.emit('meeting:join', meetingId);
  }

  leaveMeeting(meetingId: string): void {
    this.activeMeetingId = null;
    this.socket?.emit('meeting:leave', meetingId);
  }

  // ── Ledger ──────────────────────────────────────────────

  subscribeLedger(orgId: string): void {
    this.socket?.emit('ledger:subscribe', orgId);
  }

  // ── Translation ─────────────────────────────────────────

  setTranslationLanguage(meetingId: string, language: string, receiveVoice: boolean = true): void {
    this.socket?.emit('translation:set-language', { meetingId, language, receiveVoice });
  }

  sendSpeechForTranslation(meetingId: string, text: string, sourceLang: string, isFinal: boolean): void {
    this.socket?.emit('translation:speech', { meetingId, text, sourceLang, isFinal });
  }

  // ── Status ──────────────────────────────────────────────

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  get socketId(): string | undefined {
    return this.socket?.id;
  }
}

export const socketClient = new SocketClient();
