// ============================================================
// OrgsLedger Mobile — Socket.io Client
// Event-driven real-time layer with reconnection
// and room auto-rejoin.
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
    });

    this.socket.on('disconnect', (_reason) => {
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


  // ── Ledger ──────────────────────────────────────────────

  subscribeLedger(orgId: string): void {
    this.socket?.emit('ledger:subscribe', orgId);
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
