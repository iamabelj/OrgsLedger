import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/socket/socket_client.dart';
import '../../../data/models/models.dart';

class ChatConversationScreen extends ConsumerStatefulWidget {
  final String channelId;
  const ChatConversationScreen({super.key, required this.channelId});
  @override
  ConsumerState<ChatConversationScreen> createState() =>
      _ChatConversationScreenState();
}

class _ChatConversationScreenState
    extends ConsumerState<ChatConversationScreen> {
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  List<ChatMessage> _messages = [];
  bool _loading = true;
  String _channelName = 'Chat';

  // ── Typing indicator state ──────────────────────────
  final Set<String> _typingUserIds = {};
  Timer? _typingDebounce;
  bool _iAmTyping = false;
  Timer? _typingTimeout;

  @override
  void initState() {
    super.initState();
    _loadMessages();
    _listenSocket();
    _joinChannel();
  }

  void _joinChannel() {
    socketClient.emit('channel:join', widget.channelId);
  }

  void _listenSocket() {
    socketClient.on('message:new', _onNewMessage);
    socketClient.on('channel:typing', _onTyping);
    socketClient.on('channel:stop-typing', _onStopTyping);
  }

  void _onNewMessage(dynamic data) {
    if (!mounted) return;
    if (data is Map<String, dynamic>) {
      final channelId =
          data['channel_id']?.toString() ?? data['channelId']?.toString();
      if (channelId == widget.channelId) {
        final newMsg = ChatMessage.fromJson(data);
        // Skip if we already have this message (optimistic or duplicate)
        final myId = ref.read(authProvider).user?.id;
        if (newMsg.userId == myId) {
          // Remove the optimistic temp message and replace with server version
          setState(() {
            _messages.removeWhere(
              (m) => m.id.startsWith('temp_') && m.content == newMsg.content,
            );
            _messages.add(newMsg);
          });
        } else {
          setState(() => _messages.add(newMsg));
        }
        _scrollToBottom();
      }
    }
  }

  void _onTyping(dynamic data) {
    if (!mounted) return;
    if (data is Map<String, dynamic>) {
      final channelId =
          data['channel_id']?.toString() ?? data['channelId']?.toString();
      final userId = data['userId']?.toString() ?? data['user_id']?.toString();
      final myId = ref.read(authProvider).user?.id;
      if (channelId == widget.channelId && userId != null && userId != myId) {
        setState(() => _typingUserIds.add(userId));
        // Auto-remove after 4s of no further typing events
        _typingTimeout?.cancel();
        _typingTimeout = Timer(const Duration(seconds: 4), () {
          if (mounted) setState(() => _typingUserIds.remove(userId));
        });
      }
    }
  }

  void _onStopTyping(dynamic data) {
    if (!mounted) return;
    if (data is Map<String, dynamic>) {
      final channelId =
          data['channel_id']?.toString() ?? data['channelId']?.toString();
      final userId = data['userId']?.toString() ?? data['user_id']?.toString();
      if (channelId == widget.channelId && userId != null) {
        setState(() => _typingUserIds.remove(userId));
      }
    }
  }

  void _onTextChanged(String text) {
    if (text.trim().isNotEmpty && !_iAmTyping) {
      _iAmTyping = true;
      socketClient.emit('channel:typing', {'channelId': widget.channelId});
    }
    _typingDebounce?.cancel();
    _typingDebounce = Timer(const Duration(seconds: 2), () {
      if (_iAmTyping) {
        _iAmTyping = false;
        socketClient.emit('channel:stop-typing', {
          'channelId': widget.channelId,
        });
      }
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _loadMessages() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getMessages(orgId, widget.channelId);
      final data = res.data;
      final msgs = (data['messages'] ?? data['data'] ?? data) as List? ?? [];
      if (mounted) {
        setState(() {
          _messages = msgs.map((m) => ChatMessage.fromJson(m)).toList();
          _channelName = data['channel']?['name']?.toString() ?? _channelName;
          _loading = false;
        });
        _scrollToBottom();
      }
      api.markChannelRead(orgId, widget.channelId);
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendMessage() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) return;
    _msgCtrl.clear();
    // Stop typing indicator when sending
    if (_iAmTyping) {
      _iAmTyping = false;
      socketClient.emit('channel:stop-typing', {'channelId': widget.channelId});
    }
    _typingDebounce?.cancel();

    final auth = ref.read(authProvider);
    final orgId = auth.currentOrgId;
    final user = auth.user;
    if (orgId == null) return;

    // Optimistically add message locally
    final optimisticMsg = ChatMessage(
      id: 'temp_${DateTime.now().millisecondsSinceEpoch}',
      channelId: widget.channelId,
      userId: user?.id ?? '',
      userName: user?.displayName,
      content: text,
      createdAt: DateTime.now().toUtc().toIso8601String(),
    );
    setState(() => _messages.add(optimisticMsg));
    _scrollToBottom();

    try {
      await api.sendMessage(orgId, widget.channelId, {'content': text});
    } catch (_) {}
  }

  Future<void> _pickAndSendFile() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;

    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
      allowMultiple: false,
    );

    if (result == null || result.files.isEmpty) return;
    final file = result.files.first;
    final filePath = file.path;
    if (filePath == null) return;

    try {
      await api.uploadDocument(orgId, filePath);
      await api.sendMessage(orgId, widget.channelId, {
        'content': '📎 Shared file: ${file.name}',
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to upload file'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  @override
  void dispose() {
    socketClient.off('message:new', _onNewMessage);
    socketClient.off('channel:typing', _onTyping);
    socketClient.off('channel:stop-typing', _onStopTyping);
    socketClient.emit('channel:leave', widget.channelId);
    // Send stop-typing if still typing
    if (_iAmTyping) {
      socketClient.emit('channel:stop-typing', {'channelId': widget.channelId});
    }
    _typingDebounce?.cancel();
    _typingTimeout?.cancel();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final myId = auth.user?.id;

    return Scaffold(
      appBar: AppBar(title: Text(_channelName)),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: AppColors.highlight,
                    ),
                  )
                : _messages.isEmpty
                ? RefreshIndicator(
                    onRefresh: _loadMessages,
                    color: AppColors.highlight,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(
                          height: MediaQuery.of(context).size.height * 0.5,
                          child: Center(
                            child: Text(
                              'No messages yet',
                              style: AppTypography.bodySmall,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _loadMessages,
                    color: AppColors.highlight,
                    child: ListView.builder(
                      controller: _scrollCtrl,
                      padding: const EdgeInsets.all(AppSpacing.md),
                      itemCount: _messages.length,
                      itemBuilder: (_, i) {
                        final msg = _messages[i];
                        final isMine = msg.userId == myId;
                        return _MessageBubble(message: msg, isMine: isMine);
                      },
                    ),
                  ),
          ),
          // ── Typing indicator ──────────────────────────
          if (_typingUserIds.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: 4,
              ),
              child: Row(
                children: [
                  _TypingDots(),
                  const SizedBox(width: 8),
                  Text(
                    _typingUserIds.length == 1
                        ? 'Someone is typing...'
                        : '${_typingUserIds.length} people are typing...',
                    style: TextStyle(
                      color: AppColors.textLight,
                      fontSize: 12,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ],
              ),
            ),
          _buildInput(),
        ],
      ),
    );
  }

  Widget _buildInput() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.border.withValues(alpha: 0.3)),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            IconButton(
              onPressed: _pickAndSendFile,
              icon: const Icon(
                Icons.attach_file,
                color: AppColors.textSecondary,
              ),
            ),
            Expanded(
              child: TextField(
                controller: _msgCtrl,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  hintText: 'Type a message...',
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                ),
                onChanged: _onTextChanged,
                onSubmitted: (_) => _sendMessage(),
              ),
            ),
            IconButton(
              onPressed: _sendMessage,
              icon: const Icon(Icons.send, color: AppColors.highlight),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Animated typing dots ──────────────────────────────────
class _TypingDots extends StatefulWidget {
  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final delay = i * 0.2;
            final t = ((_ctrl.value - delay) % 1.0).clamp(0.0, 1.0);
            final scale = 0.5 + 0.5 * (t < 0.5 ? t * 2 : (1 - t) * 2);
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 1.5),
              child: Transform.scale(
                scale: scale,
                child: Container(
                  width: 6,
                  height: 6,
                  decoration: const BoxDecoration(
                    color: AppColors.highlight,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            );
          }),
        );
      },
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isMine;
  const _MessageBubble({required this.message, required this.isMine});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: isMine ? AppColors.highlight : AppColors.surfaceAlt,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(AppRadius.md),
            topRight: Radius.circular(AppRadius.md),
            bottomLeft: Radius.circular(isMine ? AppRadius.md : 4),
            bottomRight: Radius.circular(isMine ? 4 : AppRadius.md),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isMine && message.userName != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  message.userName!,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: isMine ? Colors.white70 : AppColors.highlight,
                  ),
                ),
              ),
            Text(
              message.content,
              style: TextStyle(
                color: isMine ? Colors.white : AppColors.textPrimary,
                fontSize: 14,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
