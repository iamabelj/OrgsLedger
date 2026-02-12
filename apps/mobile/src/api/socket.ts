// ============================================================
// OrgsLedger Mobile — Socket.io Client
// ============================================================

import { io, Socket } from 'socket.io-client';
import storage from '../utils/storage';

const SOCKET_URL = __DEV__
  ? 'http://localhost:3000'
  : 'https://test.orgsledger.com';

class SocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  async connect(): Promise<void> {
    const token = await storage.getItemAsync('accessToken');
    if (!token) return;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });

    // Re-attach listeners
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

  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    this.socket?.on(event, callback as any);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
      this.socket?.off(event, callback as any);
    };
  }

  emit(event: string, data?: any): void {
    this.socket?.emit(event, data);
  }

  joinChannel(channelId: string): void {
    this.socket?.emit('channel:join', channelId);
  }

  leaveChannel(channelId: string): void {
    this.socket?.emit('channel:leave', channelId);
  }

  joinMeeting(meetingId: string): void {
    this.socket?.emit('meeting:join', meetingId);
  }

  leaveMeeting(meetingId: string): void {
    this.socket?.emit('meeting:leave', meetingId);
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

  subscribeLedger(orgId: string): void {
    this.socket?.emit('ledger:subscribe', orgId);
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const socketClient = new SocketClient();
