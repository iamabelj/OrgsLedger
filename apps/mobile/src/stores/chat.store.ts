// ============================================================
// OrgsLedger Mobile — Chat Store (Zustand)
// ============================================================

import { create } from 'zustand';
import { api } from '../api/client';
import { socketClient } from '../api/socket';

interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  thread_id?: string;
  is_edited: boolean;
  created_at: string;
  senderFirstName?: string;
  senderLastName?: string;
  senderAvatar?: string;
  threadCount?: number;
  attachments?: any[];
}

interface Channel {
  id: string;
  name: string;
  type: string;
  description?: string;
  unreadCount: number;
}

interface ChatState {
  channels: Channel[];
  messages: Record<string, Message[]>;
  activeChannelId: string | null;
  isLoading: boolean;

  loadChannels: (orgId: string) => Promise<void>;
  loadMessages: (orgId: string, channelId: string) => Promise<void>;
  sendMessage: (orgId: string, channelId: string, content: string, threadId?: string, attachmentIds?: string[]) => Promise<void>;
  setActiveChannel: (channelId: string) => void;
  addRealtimeMessage: (channelId: string, message: Message) => void;
  markChannelRead: (orgId: string, channelId: string) => void;
  clearUnread: (channelId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  channels: [],
  messages: {},
  activeChannelId: null,
  isLoading: false,

  loadChannels: async (orgId) => {
    try {
      const { data } = await api.chat.listChannels(orgId);
      set({ channels: data.data });
    } catch (err) {
      console.error('Failed to load channels', err);
    }
  },

  loadMessages: async (orgId, channelId) => {
    try {
      set({ isLoading: true });
      const { data } = await api.chat.getMessages(orgId, channelId);
      set((state) => ({
        messages: { ...state.messages, [channelId]: data.data },
        isLoading: false,
      }));
      socketClient.joinChannel(channelId);
    } catch (err) {
      set({ isLoading: false });
      console.error('Failed to load messages', err);
    }
  },

  sendMessage: async (orgId, channelId, content, threadId, attachmentIds) => {
    await api.chat.sendMessage(orgId, channelId, { content, threadId, attachmentIds });
  },

  setActiveChannel: (channelId) => {
    const prev = get().activeChannelId;
    if (prev) socketClient.leaveChannel(prev);
    set({ activeChannelId: channelId });
    socketClient.joinChannel(channelId);
  },

  addRealtimeMessage: (channelId, message) => {
    set((state) => {
      const channelMessages = state.messages[channelId] || [];
      // Increment unread count for channels not currently active
      const channels = state.channels.map((ch) =>
        ch.id === channelId && state.activeChannelId !== channelId
          ? { ...ch, unreadCount: (ch.unreadCount || 0) + 1 }
          : ch
      );
      return {
        channels,
        messages: {
          ...state.messages,
          [channelId]: [...channelMessages, message],
        },
      };
    });
  },

  markChannelRead: (orgId, channelId) => {
    // Emit socket event and update API
    socketClient.markChannelRead(channelId);
    api.chat.markRead(orgId, channelId).catch(() => {});
    // Clear unread count locally
    set((state) => ({
      channels: state.channels.map((ch) =>
        ch.id === channelId ? { ...ch, unreadCount: 0 } : ch
      ),
    }));
  },

  clearUnread: (channelId) => {
    set((state) => ({
      channels: state.channels.map((ch) =>
        ch.id === channelId ? { ...ch, unreadCount: 0 } : ch
      ),
    }));
  },
}));
