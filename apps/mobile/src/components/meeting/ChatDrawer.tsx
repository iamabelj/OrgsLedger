// ============================================================
// OrgsLedger — ChatDrawer Component
// In-meeting chat panel (side drawer or bottom sheet).
// ============================================================

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../theme';
import { type ChatMessage } from '../../contexts/MeetingContext';

interface ChatDrawerProps {
  messages: ChatMessage[];
  currentUserId: string | null;
  onSend: (message: string) => void;
  onClose: () => void;
}

// ── Single message row ────────────────────────────────────

const ChatBubble = memo(({ item, isOwn }: { item: ChatMessage; isOwn: boolean }) => {
  const time = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[styles.bubbleWrap, isOwn ? styles.bubbleRight : styles.bubbleLeft]}>
      {!isOwn && (
        <Text style={styles.senderName}>{item.senderName}</Text>
      )}
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={styles.messageText}>{item.message}</Text>
      </View>
      <Text style={[styles.timeText, isOwn && { textAlign: 'right' }]}>{time}</Text>
    </View>
  );
});

// ── Main Component ────────────────────────────────────────

export function ChatDrawer({ messages, currentUserId, onSend, onClose }: ChatDrawerProps) {
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => (
    <ChatBubble item={item} isOwn={item.senderId === currentUserId} />
  ), [currentUserId]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="chatbubbles" size={18} color={Colors.highlight} />
        <Text style={styles.headerTitle}>Meeting Chat</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={20} color={Colors.textLight} />
        </TouchableOpacity>
      </View>

      {/* Messages list */}
      <FlatList
        ref={listRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        inverted={false}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={Colors.textLight} />
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptyHint}>Send a message to start the conversation</Text>
          </View>
        }
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={Colors.textLight}
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline={false}
          maxLength={2000}
          autoCorrect
        />
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim()}
          activeOpacity={0.7}
        >
          <Ionicons name="send" size={18} color={text.trim() ? '#FFF' : Colors.textLight} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  headerTitle: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: Spacing.sm,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xl,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    fontWeight: FontWeight.semibold,
  },
  emptyHint: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  bubbleWrap: {
    marginBottom: Spacing.xs,
    maxWidth: '80%',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
  },
  senderName: {
    fontSize: 10,
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
    marginBottom: 2,
    marginLeft: 4,
  },
  bubble: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md,
  },
  bubbleOwn: {
    backgroundColor: Colors.highlight,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: Colors.primaryLight,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: FontSize.sm,
    color: Colors.textWhite,
    lineHeight: 20,
  },
  timeText: {
    fontSize: 9,
    color: Colors.textLight,
    marginTop: 2,
    marginHorizontal: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.accent,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'web' ? Spacing.xs + 2 : Spacing.sm,
    color: Colors.textWhite,
    fontSize: FontSize.sm,
    maxHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.primaryLight,
  },
});
