// ============================================================
// OrgsLedger Mobile — Channel Messages Screen (Royal Design)
// ============================================================

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ActionSheetIOS,
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { useChatStore } from '../../src/stores/chat.store';
import { socketClient } from '../../src/api/socket';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Avatar, useContentStyle } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';
import { resolveUploadUrl } from '../../src/utils/uploads';

export default function ChannelMessagesScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);
  const messages = useChatStore((s) => (channelId ? s.messages[channelId] || [] : []));
  const loadMessages = useChatStore((s) => s.loadMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const addRealtimeMessage = useChatStore((s) => s.addRealtimeMessage);
  const markChannelRead = useChatStore((s) => s.markChannelRead);
  const channels = useChatStore((s) => s.channels);

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    { id: string; name: string; uri: string; mimeType: string }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const contentStyle = useContentStyle({ maxWidth: 900 });

  const channel = channels.find((c) => c.id === channelId);

  useEffect(() => {
    if (!currentOrgId || !channelId) return;
    setLoading(true);
    loadMessages(currentOrgId, channelId).finally(() => {
      setLoading(false);
      // Mark channel as read when opening
      if (currentOrgId && channelId) markChannelRead(currentOrgId, channelId);
    });

    // Join channel room
    socketClient.joinChannel(channelId);

    // Listen for new messages
    const unsub = socketClient.on('message:new', (msg: any) => {
      if (msg.channel_id === channelId) {
        addRealtimeMessage(channelId, msg);
        // Auto-mark as read since user is viewing this channel
        if (currentOrgId) markChannelRead(currentOrgId, channelId);
      }
    });

    return () => {
      unsub();
      socketClient.leaveChannel(channelId);
    };
  }, [currentOrgId, channelId]);

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      // Use HTML file input on web
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.onchange = async (e: any) => {
        const files = Array.from(e.target.files || []) as File[];
        if (!files.length) return;
        await uploadFiles(files);
      };
      input.click();
      return;
    }
    const ImagePicker = require('expo-image-picker');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please grant media library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    await uploadFiles(
      result.assets.map((a: any) => ({
        uri: a.uri,
        name: a.fileName || `image_${Date.now()}.jpg`,
        mimeType: a.mimeType || 'image/jpeg',
      }))
    );
  };

  const pickDocument = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async (e: any) => {
        const files = Array.from(e.target.files || []) as File[];
        if (!files.length) return;
        await uploadFiles(files);
      };
      input.click();
      return;
    }
    const DocumentPicker = require('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    await uploadFiles(
      result.assets.map((a: any) => ({
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType || 'application/octet-stream',
      }))
    );
  };

  const uploadFiles = async (
    files: ({ uri: string; name: string; mimeType: string } | File)[]
  ) => {
    if (!currentOrgId || !channelId) return;
    setUploading(true);
    try {
      const { data } = await api.chat.uploadFiles(currentOrgId, channelId, files);
      const uploaded = data.data.map((att: any, i: number) => {
        const f = files[i];
        const uri = typeof File !== 'undefined' && f instanceof File
          ? URL.createObjectURL(f)
          : (f as { uri: string }).uri;
        return {
          id: att.id,
          name: att.file_name,
          uri,
          mimeType: att.mime_type,
        };
      });
      setPendingAttachments((prev) => [...prev, ...uploaded]);
    } catch {
      showAlert('Upload failed', 'Could not upload files. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const showAttachOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Photo / Video', 'Document'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) pickImage();
          if (idx === 2) pickDocument();
        }
      );
    } else {
      showAlert('Attach', 'Choose attachment type', [
        { text: 'Photo / Video', onPress: pickImage },
        { text: 'Document', onPress: pickDocument },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const removePending = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSend = async () => {
    if ((!text.trim() && !pendingAttachments.length) || !currentOrgId || !channelId) return;
    setSending(true);
    try {
      const attachmentIds = pendingAttachments.map((a) => a.id);
      await sendMessage(
        currentOrgId,
        channelId,
        text.trim() || (pendingAttachments.length ? '📎 Attachment' : ''),
        undefined,
        attachmentIds.length ? attachmentIds : undefined
      );
      setText('');
      setPendingAttachments([]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      console.warn('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isOwn = item.sender_id === userId;
    const initials = `${(item.senderFirstName?.[0] || '?').toUpperCase()}${(item.senderLastName?.[0] || '').toUpperCase()}`;
    return (
      <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
        {!isOwn && <Avatar name={initials} size={32} imageUrl={item.senderAvatar} />}
        <View style={[styles.messageBubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
          {!isOwn && (
            <Text style={styles.senderName}>
              {item.senderFirstName || 'User'} {item.senderLastName || ''}
            </Text>
          )}
          <Text style={styles.messageText}>{item.content}</Text>
          {/* Render attachments */}
          {item.attachments?.length > 0 && (
            <View style={styles.attachmentList}>
              {item.attachments.map((att: any) => {
                const isImage = /^image\//i.test(att.mime_type);
                return isImage ? (
                  <Image
                    key={att.id}
                    source={{ uri: resolveUploadUrl(att.file_url) || att.file_url }}
                    style={styles.attachmentImage}
                    resizeMode="cover"
                  />
                ) : (
                  <TouchableOpacity
                    key={att.id}
                    style={styles.attachmentFile}
                    onPress={() => Linking.openURL(resolveUploadUrl(att.file_url) || att.file_url).catch(() => {})}
                  >
                    <Ionicons name="document-attach" size={16} color={Colors.highlight} />
                    <Text style={styles.attachmentFileName} numberOfLines={1}>
                      {att.file_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <Text style={styles.timestamp}>
            {new Date(item.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          title: channel ? `# ${channel.name}` : 'Channel',
        }}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.highlight} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={[...messages].reverse()}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={[styles.messagesList, contentStyle]}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubble-outline" size={40} color={Colors.textLight} />
              <Text style={styles.emptyChatText}>No messages yet. Start the conversation!</Text>
            </View>
          }
        />
      )}

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <View style={styles.pendingBar}>
          {pendingAttachments.map((att) => (
            <View key={att.id} style={styles.pendingChip}>
              <Ionicons name="attach" size={14} color={Colors.textWhite} />
              <Text style={styles.pendingChipText} numberOfLines={1}>{att.name}</Text>
              <TouchableOpacity onPress={() => removePending(att.id)}>
                <Ionicons name="close-circle" size={16} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachBtn} onPress={showAttachOptions}>
          {uploading ? (
            <ActivityIndicator size="small" color={Colors.highlight} />
          ) : (
            <Ionicons name="add-circle" size={28} color={Colors.highlight} />
          )}
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          placeholder="Type a message..."
          placeholderTextColor={Colors.textLight}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() && !pendingAttachments.length || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={(!text.trim() && !pendingAttachments.length) || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color={Colors.textWhite} />
          ) : (
            <Ionicons name="send" size={20} color={Colors.textWhite} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: Spacing.sm },
  messageRowOwn: { flexDirection: 'row-reverse' },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  ownBubble: {
    backgroundColor: Colors.highlight,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
    ...Shadow.sm,
  },
  otherBubble: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 0.5,
    borderColor: Colors.accent,
  },
  senderName: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
    marginBottom: 2,
  },
  messageText: { fontSize: FontSize.md, color: Colors.textWhite, lineHeight: 20 },
  timestamp: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'right',
    marginTop: 3,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    marginTop: Spacing.xxl * 3,
    gap: Spacing.md,
  },
  emptyChatText: { color: Colors.textLight, fontSize: FontSize.md },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: Colors.accent,
  },
  attachBtn: { paddingRight: Spacing.xs, paddingBottom: 6 },
  textInput: {
    flex: 1,
    backgroundColor: Colors.primaryLight,
    color: Colors.textWhite,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.sm + 2 : Spacing.sm,
    fontSize: FontSize.md,
    maxHeight: 100,
    borderWidth: 0.5,
    borderColor: Colors.accent,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.xs,
    ...Shadow.sm,
  },
  sendBtnDisabled: { opacity: 0.35 },
  attachmentList: { marginTop: 6, gap: 4 },
  attachmentImage: {
    width: 180,
    height: 120,
    borderRadius: BorderRadius.md,
    marginTop: 4,
  },
  attachmentFile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    marginTop: 4,
  },
  attachmentFileName: {
    color: Colors.textWhite,
    fontSize: FontSize.xs,
    flex: 1,
  },
  pendingBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: Colors.accent,
  },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.highlightSubtle,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
    maxWidth: 160,
  },
  pendingChipText: {
    color: Colors.textWhite,
    fontSize: FontSize.xs,
    flex: 1,
  },
});
