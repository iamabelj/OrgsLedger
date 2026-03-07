import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';
import '../../../data/socket/socket_client.dart';

class ChatListScreen extends ConsumerStatefulWidget {
  const ChatListScreen({super.key});
  @override
  ConsumerState<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends ConsumerState<ChatListScreen> {
  List<ChatChannel> _channels = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadChannels();
    _listenSocket();
  }

  void _listenSocket() {
    socketClient.on('message:new', (_) => _loadChannels());
    socketClient.on('channel:created', (_) => _loadChannels());
  }

  @override
  void dispose() {
    socketClient.off('message:new');
    socketClient.off('channel:created');
    super.dispose();
  }

  Future<void> _loadChannels() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getChannels(orgId);
      final data = (res.data['data'] ?? res.data) as List? ?? [];
      if (mounted) {
        setState(() {
          _channels = data.map((c) => ChatChannel.fromJson(c)).toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Failed to load channels';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: MediaQuery.of(context).size.width < 1024
            ? IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              )
            : null,
        title: const Text('Chat'),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateChannel(context),
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 48,
                    color: AppColors.error,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(_error!, style: AppTypography.body),
                  const SizedBox(height: AppSpacing.md),
                  ElevatedButton(
                    onPressed: () {
                      setState(() {
                        _error = null;
                        _loading = true;
                      });
                      _loadChannels();
                    },
                    child: const Text('Retry'),
                  ),
                ],
              ),
            )
          : _channels.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.chat_bubble_outline,
                    size: 64,
                    color: AppColors.textLight,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('No channels yet', style: AppTypography.bodySmall),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadChannels,
              child: ListView.builder(
                itemCount: _channels.length,
                itemBuilder: (_, i) {
                  final ch = _channels[i];
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor: ch.type == 'dm'
                          ? AppColors.info
                          : AppColors.highlightSubtle,
                      child: Icon(
                        ch.type == 'dm' ? Icons.person : Icons.tag,
                        color: ch.type == 'dm'
                            ? AppColors.textWhite
                            : AppColors.highlight,
                        size: 18,
                      ),
                    ),
                    title: Text(
                      ch.name,
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: ch.unreadCount > 0
                            ? FontWeight.w700
                            : FontWeight.w400,
                      ),
                    ),
                    subtitle: ch.lastMessage != null
                        ? Text(
                            ch.lastMessage!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.caption,
                          )
                        : null,
                    trailing: ch.unreadCount > 0
                        ? Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.highlight,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              '${ch.unreadCount}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                              ),
                            ),
                          )
                        : null,
                    onTap: () => context.push('/chat/${ch.id}'),
                  );
                },
              ),
            ),
    );
  }

  void _showCreateChannel(BuildContext context) {
    final nameCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Channel'),
        content: TextField(
          controller: nameCtrl,
          style: const TextStyle(color: AppColors.textPrimary),
          decoration: const InputDecoration(hintText: 'Channel name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final orgId = ref.read(authProvider).currentOrgId;
              if (orgId == null || nameCtrl.text.trim().isEmpty) return;
              try {
                await api.createChannel(orgId, {'name': nameCtrl.text.trim()});
                if (ctx.mounted) Navigator.pop(ctx);
                _loadChannels();
              } catch (_) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Failed to create channel')),
                  );
                }
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
