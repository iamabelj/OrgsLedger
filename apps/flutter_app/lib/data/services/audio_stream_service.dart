import 'dart:async';
import 'dart:typed_data';
import 'package:record/record.dart';
import '../socket/socket_client.dart';

/// Service for streaming audio to server for real-time STT.
/// Uses the `record` package to capture PCM audio and sends chunks via socket.
class AudioStreamService {
  static final AudioStreamService _instance = AudioStreamService._();
  factory AudioStreamService() => _instance;
  AudioStreamService._();

  AudioRecorder? _recorder;
  StreamSubscription<Uint8List>? _streamSubscription;
  String? _activeMeetingId;
  bool _isStreaming = false;

  bool get isStreaming => _isStreaming;

  /// Start streaming audio to the server for STT.
  /// [meetingId] - The meeting to associate the audio with
  /// [language] - Language code (e.g., 'en', 'es', 'fr') for STT
  Future<bool> startStreaming(String meetingId, {String language = 'en'}) async {
    if (_isStreaming) {
      await stopStreaming();
    }

    try {
      _recorder = AudioRecorder();

      // Check permission
      final hasPermission = await _recorder!.hasPermission();
      if (!hasPermission) {
        print('[AudioStream] Microphone permission denied');
        return false;
      }

      _activeMeetingId = meetingId;

      // Tell server to start STT session
      socketClient.startAudioStream(
        meetingId,
        language: language,
        encoding: 'LINEAR16',
        sampleRate: 16000,
      );

      // Configure for PCM streaming (LINEAR16)
      const config = RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
        autoGain: true,
        echoCancel: true,
        noiseSuppress: true,
      );

      // Start recording as a stream
      final stream = await _recorder!.startStream(config);

      _streamSubscription = stream.listen(
        (Uint8List chunk) {
          if (_activeMeetingId != null && chunk.isNotEmpty) {
            // Send audio chunk to server
            socketClient.sendAudioChunk(_activeMeetingId!, chunk.toList());
          }
        },
        onError: (error) {
          print('[AudioStream] Stream error: $error');
          stopStreaming();
        },
        onDone: () {
          print('[AudioStream] Stream done');
        },
      );

      _isStreaming = true;
      print('[AudioStream] Started streaming for meeting: $meetingId, language: $language');
      return true;
    } catch (e) {
      print('[AudioStream] Failed to start: $e');
      await _cleanup();
      return false;
    }
  }

  /// Stop streaming audio.
  Future<void> stopStreaming() async {
    if (!_isStreaming) return;

    print('[AudioStream] Stopping stream for meeting: $_activeMeetingId');

    // Tell server to stop STT session
    if (_activeMeetingId != null) {
      socketClient.stopAudioStream(_activeMeetingId!);
    }

    await _cleanup();
  }

  Future<void> _cleanup() async {
    _isStreaming = false;

    await _streamSubscription?.cancel();
    _streamSubscription = null;

    try {
      await _recorder?.stop();
    } catch (_) {}

    try {
      await _recorder?.dispose();
    } catch (_) {}

    _recorder = null;
    _activeMeetingId = null;
  }

  /// Dispose of resources.
  Future<void> dispose() async {
    await stopStreaming();
  }
}

/// Global singleton instance
final audioStreamService = AudioStreamService();
