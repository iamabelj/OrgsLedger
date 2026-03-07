import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/socket/socket_client.dart';
import '../../../data/services/audio_stream_service.dart';

/// Full-screen LiveKit video meeting room.
class MeetingRoomScreen extends ConsumerStatefulWidget {
  final String meetingId;
  final String token;

  const MeetingRoomScreen({
    super.key,
    required this.meetingId,
    required this.token,
  });

  @override
  ConsumerState<MeetingRoomScreen> createState() => _MeetingRoomScreenState();
}

class _MeetingRoomScreenState extends ConsumerState<MeetingRoomScreen> {
  Room? _room;
  LocalParticipant? _localParticipant;
  final List<RemoteParticipant> _remoteParticipants = [];
  EventsListener<RoomEvent>? _listener;

  bool _connecting = true;
  String? _error;

  // Local media state
  bool _micEnabled = true;
  bool _cameraEnabled = true;
  bool _screenSharing = false;

  // Side panel
  _SidePanel _sidePanel = _SidePanel.none;

  // Chat messages for in-meeting chat
  final List<_MeetingChatMessage> _chatMessages = [];
  final TextEditingController _chatController = TextEditingController();

  // AI state
  bool _aiEnabled = false;
  bool _togglingAi = false;

  // Transcription & Minutes state
  List<Map<String, dynamic>> _transcripts = [];
  String? _minutes;
  bool _loadingMinutes = false;
  bool _generatingMinutes = false;

  // Live Translation state
  bool _translationEnabled = false;
  String _myLanguage = 'en';
  final List<Map<String, dynamic>> _liveTranslations = [];
  String _interimText = '';

  // Available languages for translation
  static const _languages = [
    {'code': 'en', 'name': 'English'},
    {'code': 'es', 'name': 'Spanish'},
    {'code': 'fr', 'name': 'French'},
    {'code': 'de', 'name': 'German'},
    {'code': 'pt', 'name': 'Portuguese'},
    {'code': 'zh', 'name': 'Chinese'},
    {'code': 'ja', 'name': 'Japanese'},
    {'code': 'ko', 'name': 'Korean'},
    {'code': 'ar', 'name': 'Arabic'},
    {'code': 'hi', 'name': 'Hindi'},
  ];

  @override
  void initState() {
    super.initState();
    _connectToRoom();
    socketClient.joinMeeting(widget.meetingId);
    _listenForChatMessages();
    _listenForTranslations();
    _loadTranscriptsAndMinutes();
  }

  Future<void> _connectToRoom() async {
    try {
      final room = Room(
        roomOptions: const RoomOptions(
          adaptiveStream: true,
          dynacast: true,
          defaultAudioPublishOptions: AudioPublishOptions(dtx: true),
          defaultVideoPublishOptions: VideoPublishOptions(simulcast: true),
        ),
      );

      _listener = room.createListener();
      _setupRoomListeners();

      await room.connect(kLiveKitUrl, widget.token);

      // Enable camera & mic
      await room.localParticipant?.setCameraEnabled(true);
      await room.localParticipant?.setMicrophoneEnabled(true);

      if (mounted) {
        setState(() {
          _room = room;
          _localParticipant = room.localParticipant;
          _remoteParticipants
            ..clear()
            ..addAll(room.remoteParticipants.values);
          _connecting = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to connect: ${e.toString()}';
          _connecting = false;
        });
      }
    }
  }

  void _setupRoomListeners() {
    _listener
      ?..on<ParticipantConnectedEvent>((event) {
        if (mounted) {
          setState(() {
            _remoteParticipants.add(event.participant);
          });
        }
      })
      ..on<ParticipantDisconnectedEvent>((event) {
        if (mounted) {
          setState(() {
            _remoteParticipants.removeWhere(
              (p) => p.identity == event.participant.identity,
            );
          });
        }
      })
      ..on<TrackSubscribedEvent>((_) {
        if (mounted) setState(() {});
      })
      ..on<TrackUnsubscribedEvent>((_) {
        if (mounted) setState(() {});
      })
      ..on<TrackMutedEvent>((_) {
        if (mounted) setState(() {});
      })
      ..on<TrackUnmutedEvent>((_) {
        if (mounted) setState(() {});
      })
      ..on<RoomDisconnectedEvent>((_) {
        if (mounted) _handleDisconnect();
      });
  }

  void _listenForChatMessages() {
    socketClient.on('chat:new', (data) {
      if (data is Map<String, dynamic> && mounted) {
        setState(() {
          _chatMessages.add(
            _MeetingChatMessage(
              userName: data['senderName']?.toString() ?? 'Unknown',
              content: data['message']?.toString() ?? '',
              timestamp:
                  DateTime.tryParse(data['createdAt']?.toString() ?? '') ??
                  DateTime.now(),
            ),
          );
        });
      }
    });
  }

  void _listenForTranslations() {
    // Listen for interim transcripts/translations (real-time subtitles)
    socketClient.on('translation:interim', (data) {
      if (data is Map<String, dynamic> && mounted) {
        final text = data['originalText']?.toString() ??
            data['text']?.toString() ??
            '';
        final speaker = data['speakerName']?.toString() ?? 'Unknown';

        if (text.isNotEmpty) {
          setState(() => _interimText = '[$speaker]: $text');
        }
      }
    });

    // Listen for final transcripts with translations
    socketClient.on('translation:result', (data) {
      if (data is Map<String, dynamic> && mounted) {
        final originalText = data['originalText']?.toString() ?? '';
        final speaker = data['speakerName']?.toString() ?? 'Unknown';
        final translations =
            data['translations'] as Map<String, dynamic>? ?? {};

        // Show translated text in user's language if available, else original
        String displayText = originalText;
        if (_myLanguage.isNotEmpty && translations.containsKey(_myLanguage)) {
          displayText = translations[_myLanguage]?.toString() ?? originalText;
        }

        if (displayText.isNotEmpty) {
          setState(() {
            _liveTranslations.add({
              'speaker': speaker,
              'text': displayText,
              'timestamp': DateTime.now().toIso8601String(),
              'isTranslation': _myLanguage.isNotEmpty &&
                  translations.containsKey(_myLanguage),
            });
            _interimText = '';
            // Keep only last 50 translations
            if (_liveTranslations.length > 50) {
              _liveTranslations.removeAt(0);
            }
          });
        }
      }
    });

    // Listen for minutes ready event (auto-refresh after meeting ends)
    socketClient.on('meeting:minutes:ready', (data) {
      if (mounted) {
        _loadTranscriptsAndMinutes();
      }
    });

    // Listen for meeting ended event
    socketClient.on('meeting:ended', (data) {
      if (mounted) {
        // Refresh transcripts and minutes after meeting ends
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) _loadTranscriptsAndMinutes();
        });
      }
    });
  }

  Future<void> _toggleTranslation() async {
    if (_translationEnabled) {
      // Stop translation
      await audioStreamService.stopStreaming();
      setState(() => _translationEnabled = false);
    } else {
      // Start translation
      final success = await audioStreamService.startStreaming(
        widget.meetingId,
        language: _myLanguage,
      );
      if (success && mounted) {
        setState(() => _translationEnabled = true);
      }
    }
  }

  Future<void> _toggleMic() async {
    if (_localParticipant == null) return;
    final newState = !_micEnabled;
    await _localParticipant!.setMicrophoneEnabled(newState);
    if (mounted) setState(() => _micEnabled = newState);
  }

  Future<void> _toggleCamera() async {
    if (_localParticipant == null) return;
    final newState = !_cameraEnabled;
    await _localParticipant!.setCameraEnabled(newState);
    if (mounted) setState(() => _cameraEnabled = newState);
  }

  Future<void> _toggleScreenShare() async {
    if (_localParticipant == null) return;
    final newState = !_screenSharing;
    await _localParticipant!.setScreenShareEnabled(newState);
    if (mounted) setState(() => _screenSharing = newState);
  }

  Future<void> _toggleAi() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    setState(() => _togglingAi = true);
    try {
      await api.toggleAi(orgId, widget.meetingId);
      if (mounted) {
        setState(() {
          _aiEnabled = !_aiEnabled;
          _togglingAi = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _togglingAi = false);
    }
  }

  void _sendChatMessage() {
    final text = _chatController.text.trim();
    if (text.isEmpty) return;
    socketClient.emit('chat:send', {
      'meetingId': widget.meetingId,
      'message': text,
    });
    _chatController.clear();
  }

  void _handleDisconnect() {
    if (mounted && Navigator.canPop(context)) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _leaveMeeting() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    try {
      await api.leaveMeeting(orgId, widget.meetingId);
    } catch (_) {}
    socketClient.leaveMeeting(widget.meetingId);
    await _room?.disconnect();
    if (mounted && Navigator.canPop(context)) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _loadTranscriptsAndMinutes() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    if (mounted) setState(() => _loadingMinutes = true);
    try {
      final results = await Future.wait([
        api.getTranscripts(orgId, widget.meetingId),
        api.getMinutes(orgId, widget.meetingId),
      ]);
      final tData = results[0].data['data'] ?? results[0].data;
      final mData = results[1].data['data'] ?? results[1].data;
      if (mounted) {
        setState(() {
          _loadingMinutes = false;
          if (tData is List) {
            _transcripts = tData.cast<Map<String, dynamic>>();
          }
          if (mData is Map<String, dynamic>) {
            _minutes = mData['summary']?.toString() ??
                mData['content']?.toString() ??
                mData['minutes']?.toString();
          } else if (mData is String) {
            _minutes = mData;
          }
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingMinutes = false);
    }
  }

  Future<void> _generateMinutes() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    setState(() => _generatingMinutes = true);
    try {
      await api.generateMinutes(orgId, widget.meetingId);
      await _loadTranscriptsAndMinutes();
    } catch (_) {}
    if (mounted) setState(() => _generatingMinutes = false);
  }

  @override
  void dispose() {
    _listener?.dispose();
    _room?.disconnect();
    _chatController.dispose();
    socketClient.off('chat:new');
    socketClient.off('translation:interim');
    socketClient.off('translation:result');
    socketClient.off('meeting:minutes:ready');
    socketClient.off('meeting:ended');
    audioStreamService.stopStreaming();
    socketClient.leaveMeeting(widget.meetingId);
    super.dispose();
  }

  // ═══════════════════════════════════════════════════════
  //  BUILD
  // ═══════════════════════════════════════════════════════
  @override
  Widget build(BuildContext context) {
    if (_connecting) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(color: AppColors.highlight),
              const SizedBox(height: AppSpacing.lg),
              Text('Connecting to meeting…', style: AppTypography.body),
            ],
          ),
        ),
      );
    }

    if (_error != null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.error_outline,
                  size: 64,
                  color: AppColors.error,
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  _error!,
                  style: AppTypography.body,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.lg),
                ElevatedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Go Back'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Row(
          children: [
            // Main content (video grid + controls)
            Expanded(
              child: Column(
                children: [
                  // Top bar
                  _buildTopBar(),
                  // Video grid
                  Expanded(child: _buildVideoGrid()),
                  // Control bar
                  _buildControlBar(),
                ],
              ),
            ),
            // Side panel
            if (_sidePanel != _SidePanel.none) _buildSidePanel(),
          ],
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.border, width: 1)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.fiber_manual_record,
            color: AppColors.error,
            size: 12,
          ),
          const SizedBox(width: AppSpacing.xs),
          Text(
            'LIVE',
            style: AppTypography.caption.copyWith(
              color: AppColors.error,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              '${_remoteParticipants.length + 1} participant${_remoteParticipants.isNotEmpty ? 's' : ''}',
              style: AppTypography.bodySmall,
            ),
          ),
          // AI toggle (visible to all, actionable by admin)
          _togglingAi
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.highlight,
                  ),
                )
              : IconButton(
                  onPressed: ref.watch(authProvider).isAdmin ? _toggleAi : null,
                  icon: Icon(
                    _aiEnabled
                        ? Icons.auto_awesome
                        : Icons.auto_awesome_outlined,
                    color: _aiEnabled
                        ? AppColors.highlight
                        : AppColors.textSecondary,
                    size: 20,
                  ),
                  tooltip: _aiEnabled ? 'AI Active' : 'AI Inactive',
                  visualDensity: VisualDensity.compact,
                ),
        ],
      ),
    );
  }

  Widget _buildVideoGrid() {
    final allParticipants = <Participant>[
      ?_localParticipant,
      ..._remoteParticipants,
    ];

    if (allParticipants.isEmpty) {
      return Center(
        child: Text('Waiting for participants…', style: AppTypography.body),
      );
    }

    final count = allParticipants.length;
    int crossAxisCount;
    if (count <= 1) {
      crossAxisCount = 1;
    } else if (count <= 4) {
      crossAxisCount = 2;
    } else if (count <= 9) {
      crossAxisCount = 3;
    } else {
      crossAxisCount = 4;
    }

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: GridView.builder(
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: crossAxisCount,
          crossAxisSpacing: AppSpacing.sm,
          mainAxisSpacing: AppSpacing.sm,
          childAspectRatio: 16 / 9,
        ),
        itemCount: count,
        itemBuilder: (_, i) => _buildParticipantTile(
          allParticipants[i],
          isLocal: i == 0 && _localParticipant != null,
        ),
      ),
    );
  }

  Widget _buildParticipantTile(
    Participant participant, {
    bool isLocal = false,
  }) {
    // Find the first video track
    VideoTrack? videoTrack;
    for (final tp in participant.videoTrackPublications) {
      if (tp.track != null && !tp.muted) {
        videoTrack = tp.track as VideoTrack;
        break;
      }
    }

    final isMuted =
        participant.audioTrackPublications.isEmpty ||
        participant.audioTrackPublications.every((t) => t.muted);

    final name = participant.name.isNotEmpty
        ? participant.name
        : (isLocal ? 'You' : participant.identity.toString());

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isLocal ? AppColors.highlight : AppColors.border,
          width: isLocal ? 2 : 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Video or avatar fallback
          if (videoTrack != null && !kIsWeb)
            VideoTrackRenderer(videoTrack)
          else if (videoTrack != null && kIsWeb)
            VideoTrackRenderer(videoTrack)
          else
            Center(
              child: CircleAvatar(
                radius: 32,
                backgroundColor: AppColors.highlightSubtle,
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: AppColors.highlight,
                  ),
                ),
              ),
            ),

          // Bottom info bar
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xs,
              ),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.7),
                  ],
                ),
              ),
              child: Row(
                children: [
                  if (isMuted)
                    const Padding(
                      padding: EdgeInsets.only(right: 4),
                      child: Icon(
                        Icons.mic_off,
                        size: 14,
                        color: AppColors.error,
                      ),
                    ),
                  Expanded(
                    child: Text(
                      isLocal ? '$name (You)' : name,
                      style: AppTypography.caption.copyWith(
                        color: Colors.white,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildControlBar() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border, width: 1)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Mic
            _ControlButton(
              icon: _micEnabled ? Icons.mic : Icons.mic_off,
              label: _micEnabled ? 'Mute' : 'Unmute',
              active: _micEnabled,
              onTap: _toggleMic,
            ),
            const SizedBox(width: AppSpacing.md),
            // Camera
            _ControlButton(
              icon: _cameraEnabled ? Icons.videocam : Icons.videocam_off,
              label: _cameraEnabled ? 'Camera Off' : 'Camera On',
              active: _cameraEnabled,
              onTap: _toggleCamera,
            ),
            const SizedBox(width: AppSpacing.md),
            // Screen share (not on mobile web)
            if (!kIsWeb || MediaQuery.of(context).size.width > 600)
              _ControlButton(
                icon: Icons.screen_share,
                label: _screenSharing ? 'Stop Share' : 'Share Screen',
                active: _screenSharing,
                onTap: _toggleScreenShare,
              ),
            if (!kIsWeb || MediaQuery.of(context).size.width > 600)
              const SizedBox(width: AppSpacing.md),
            // Participants
            _ControlButton(
              icon: Icons.people,
              label: 'People',
              active: _sidePanel == _SidePanel.participants,
              onTap: () => setState(() {
                _sidePanel = _sidePanel == _SidePanel.participants
                    ? _SidePanel.none
                    : _SidePanel.participants;
              }),
            ),
            const SizedBox(width: AppSpacing.md),
            // Chat
            _ControlButton(
              icon: Icons.chat_bubble_outline,
              label: 'Chat',
              active: _sidePanel == _SidePanel.chat,
              onTap: () => setState(() {
                _sidePanel = _sidePanel == _SidePanel.chat
                    ? _SidePanel.none
                    : _SidePanel.chat;
              }),
            ),
            const SizedBox(width: AppSpacing.md),
            // Transcription
            _ControlButton(
              icon: Icons.subtitles,
              label: 'Transcript',
              active: _sidePanel == _SidePanel.transcription,
              onTap: () {
                _loadTranscriptsAndMinutes();
                setState(() {
                  _sidePanel = _sidePanel == _SidePanel.transcription
                      ? _SidePanel.none
                      : _SidePanel.transcription;
                });
              },
            ),
            const SizedBox(width: AppSpacing.md),
            // Translation
            _ControlButton(
              icon: Icons.translate,
              label: 'Translate',
              active:
                  _sidePanel == _SidePanel.translation || _translationEnabled,
              onTap: () => setState(() {
                _sidePanel = _sidePanel == _SidePanel.translation
                    ? _SidePanel.none
                    : _SidePanel.translation;
              }),
            ),
            const SizedBox(width: AppSpacing.xl),
            // Leave
            _ControlButton(
              icon: Icons.call_end,
              label: 'Leave',
              active: false,
              isDestructive: true,
              onTap: _leaveMeeting,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSidePanel() {
    return Container(
      width: 320,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(left: BorderSide(color: AppColors.border, width: 1)),
      ),
      child: Column(
        children: [
          // Panel header
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: AppColors.border, width: 1),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  _sidePanel == _SidePanel.chat
                      ? Icons.chat
                      : _sidePanel == _SidePanel.transcription
                      ? Icons.subtitles
                      : _sidePanel == _SidePanel.translation
                      ? Icons.translate
                      : Icons.people,
                  color: AppColors.highlight,
                  size: 20,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    _sidePanel == _SidePanel.chat
                        ? 'Chat'
                        : _sidePanel == _SidePanel.transcription
                        ? 'Transcription & Minutes'
                        : _sidePanel == _SidePanel.translation
                        ? 'Live Translation'
                        : 'Participants',
                    style: AppTypography.h4,
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _sidePanel = _SidePanel.none),
                  icon: const Icon(
                    Icons.close,
                    color: AppColors.textSecondary,
                    size: 20,
                  ),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ),
          // Panel body
          Expanded(
            child: _sidePanel == _SidePanel.chat
                ? _buildChatPanel()
                : _sidePanel == _SidePanel.transcription
                ? _buildTranscriptionPanel()
                : _sidePanel == _SidePanel.translation
                ? _buildTranslationPanel()
                : _buildParticipantsList(),
          ),
        ],
      ),
    );
  }

  Widget _buildParticipantsList() {
    final all = <Participant>[?_localParticipant, ..._remoteParticipants];

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      itemCount: all.length,
      itemBuilder: (_, i) {
        final p = all[i];
        final isLocal = i == 0 && _localParticipant != null;
        final name = p.name.isNotEmpty
            ? p.name
            : (isLocal ? 'You' : p.identity.toString());
        final isMuted =
            p.audioTrackPublications.isEmpty ||
            p.audioTrackPublications.every((t) => t.muted);

        return ListTile(
          dense: true,
          leading: CircleAvatar(
            radius: 16,
            backgroundColor: AppColors.highlightSubtle,
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : '?',
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.highlight,
              ),
            ),
          ),
          title: Text(
            isLocal ? '$name (You)' : name,
            style: AppTypography.body.copyWith(fontSize: 13),
          ),
          trailing: Icon(
            isMuted ? Icons.mic_off : Icons.mic,
            size: 16,
            color: isMuted ? AppColors.error : AppColors.success,
          ),
        );
      },
    );
  }

  Widget _buildTranscriptionPanel() {
    return Column(
      children: [
        // Minutes section
        if (_minutes != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: Colors.blue.withValues(alpha: 0.05),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.summarize, size: 16, color: Colors.blue),
                    const SizedBox(width: 6),
                    const Text(
                      'Meeting Minutes',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Colors.blue,
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.refresh, size: 16),
                      onPressed: _generatingMinutes ? null : _generateMinutes,
                      tooltip: 'Regenerate minutes',
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _minutes!,
                  style: const TextStyle(fontSize: 12, height: 1.4),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
        ],
        // Generate minutes button (if no minutes yet)
        if (_minutes == null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _generatingMinutes ? null : _generateMinutes,
                icon: _generatingMinutes
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.auto_awesome, size: 18),
                label: Text(
                  _generatingMinutes ? 'Generating...' : 'Generate AI Minutes',
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
          ),
        const Divider(height: 1),
        // Transcripts list
        Expanded(
          child: _loadingMinutes
              ? const Center(child: CircularProgressIndicator())
              : _transcripts.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.subtitles_off,
                        size: 48,
                        color: Colors.grey[400],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _aiEnabled
                            ? 'Transcription is active.\nTranscripts will appear here.'
                            : 'Enable AI to start transcription.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey[600]),
                      ),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(8),
                  itemCount: _transcripts.length,
                  itemBuilder: (context, index) {
                    final t = _transcripts[index];
                    final speaker =
                        t['speakerName'] ?? t['speaker'] ?? 'Unknown';
                    final text = t['text'] ?? t['content'] ?? '';
                    final time = t['createdAt'] != null
                        ? DateTime.tryParse(t['createdAt'].toString())
                        : null;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CircleAvatar(
                            radius: 14,
                            backgroundColor: Colors.blue[100],
                            child: Text(
                              speaker.substring(0, 1).toUpperCase(),
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: Colors.blue,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      speaker,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                    if (time != null) ...[
                                      const SizedBox(width: 6),
                                      Text(
                                        '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
                                        style: TextStyle(
                                          fontSize: 10,
                                          color: Colors.grey[500],
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  text,
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildTranslationPanel() {
    return Column(
      children: [
        // Language selector and toggle
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _translationEnabled
                ? Colors.green.withValues(alpha: 0.1)
                : Colors.grey.withValues(alpha: 0.05),
            border: const Border(bottom: BorderSide(color: AppColors.border)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Your Language',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _myLanguage,
                          isExpanded: true,
                          icon: const Icon(Icons.expand_more, size: 18),
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.textPrimary,
                          ),
                          items: _languages.map((lang) {
                            return DropdownMenuItem(
                              value: lang['code'] as String,
                              child: Text(lang['name'] as String),
                            );
                          }).toList(),
                          onChanged: _translationEnabled
                              ? null
                              : (val) {
                                  if (val != null) {
                                    setState(() => _myLanguage = val);
                                  }
                                },
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  ElevatedButton.icon(
                    onPressed: _toggleTranslation,
                    icon: Icon(
                      _translationEnabled ? Icons.stop : Icons.mic,
                      size: 18,
                    ),
                    label: Text(
                      _translationEnabled ? 'Stop' : 'Start',
                      style: const TextStyle(fontSize: 13),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _translationEnabled
                          ? Colors.red
                          : Colors.green,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                    ),
                  ),
                ],
              ),
              if (_translationEnabled) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Text(
                      'Listening... Speak to translate',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.green,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        // Interim text (current speech)
        if (_interimText.isNotEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            color: Colors.yellow.withValues(alpha: 0.15),
            child: Text(
              _interimText,
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey[700],
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        // Live translations
        Expanded(
          child: _liveTranslations.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.translate, size: 48, color: Colors.grey[400]),
                      const SizedBox(height: 8),
                      Text(
                        _translationEnabled
                            ? 'Listening...\nTranslations will appear here.'
                            : 'Start translation to see\nlive transcripts here.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey[600]),
                      ),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(8),
                  itemCount: _liveTranslations.length,
                  reverse: true,
                  itemBuilder: (context, index) {
                    final t =
                        _liveTranslations[_liveTranslations.length - 1 - index];
                    final speaker = t['speaker'] ?? 'Unknown';
                    final text = t['text'] ?? '';
                    final isTranslation = t['isTranslation'] == true;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CircleAvatar(
                            radius: 14,
                            backgroundColor: isTranslation
                                ? Colors.purple[100]
                                : Colors.blue[100],
                            child: Text(
                              speaker.substring(0, 1).toUpperCase(),
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: isTranslation
                                    ? Colors.purple
                                    : Colors.blue,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      speaker,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                    if (isTranslation) ...[
                                      const SizedBox(width: 4),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 4,
                                          vertical: 1,
                                        ),
                                        decoration: BoxDecoration(
                                          color: Colors.purple[50],
                                          borderRadius: BorderRadius.circular(
                                            3,
                                          ),
                                        ),
                                        child: const Text(
                                          'translated',
                                          style: TextStyle(
                                            fontSize: 9,
                                            color: Colors.purple,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  text,
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildChatPanel() {
    return Column(
      children: [
        Expanded(
          child: _chatMessages.isEmpty
              ? Center(
                  child: Text(
                    'No messages yet',
                    style: AppTypography.bodySmall,
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  itemCount: _chatMessages.length,
                  reverse: true,
                  itemBuilder: (_, i) {
                    final msg = _chatMessages[_chatMessages.length - 1 - i];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                msg.userName,
                                style: AppTypography.label.copyWith(
                                  color: AppColors.highlight,
                                ),
                              ),
                              const Spacer(),
                              Text(
                                '${msg.timestamp.hour.toString().padLeft(2, '0')}:'
                                '${msg.timestamp.minute.toString().padLeft(2, '0')}',
                                style: AppTypography.caption,
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            msg.content,
                            style: AppTypography.body.copyWith(fontSize: 13),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
        // Chat input
        Container(
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.border, width: 1)),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _chatController,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textPrimary,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Type a message…',
                    hintStyle: AppTypography.bodySmall,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.sm,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                  ),
                  onSubmitted: (_) => _sendChatMessage(),
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              IconButton(
                onPressed: _sendChatMessage,
                icon: const Icon(
                  Icons.send,
                  color: AppColors.highlight,
                  size: 20,
                ),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════
//  Supporting Types
// ═══════════════════════════════════════════════════════

enum _SidePanel { none, chat, participants, transcription, translation }

class _ControlButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final bool isDestructive;
  final VoidCallback onTap;

  const _ControlButton({
    required this.icon,
    required this.label,
    required this.active,
    this.isDestructive = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final bgColor = isDestructive
        ? AppColors.error
        : active
        ? AppColors.surfaceAlt
        : AppColors.surfaceElevated;
    final iconColor = isDestructive
        ? Colors.white
        : active
        ? AppColors.highlight
        : AppColors.textSecondary;

    return Tooltip(
      message: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: iconColor, size: 22),
              const SizedBox(height: 2),
              Text(
                label,
                style: AppTypography.caption.copyWith(
                  color: iconColor,
                  fontSize: 9,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MeetingChatMessage {
  final String userName;
  final String content;
  final DateTime timestamp;

  const _MeetingChatMessage({
    required this.userName,
    required this.content,
    required this.timestamp,
  });
}
