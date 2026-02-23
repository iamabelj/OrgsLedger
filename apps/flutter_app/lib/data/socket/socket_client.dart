import 'package:socket_io_client/socket_io_client.dart' as sio;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/constants/app_constants.dart';

/// Socket.io client singleton — mirrors the Expo socketClient.
class SocketClient {
  static final SocketClient _instance = SocketClient._();
  factory SocketClient() => _instance;

  sio.Socket? _socket;
  String? _activeMeetingId;
  final _storage = const FlutterSecureStorage();

  SocketClient._();

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    final token = await _storage.read(key: 'accessToken');
    if (token == null) return;
    if (_socket?.connected == true) return;

    _socket = sio.io(
      kSocketUrl,
      sio.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(10000)
          .build(),
    );

    _socket!.onConnect((_) {
      if (_activeMeetingId != null) {
        _socket!.emit('meeting:join', _activeMeetingId);
      }
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
    _activeMeetingId = null;
  }

  // ── Room Management ───────────────────────────────────
  void joinOrg(String orgId) => _socket?.emit('org:join', orgId);
  void leaveOrg(String orgId) => _socket?.emit('org:leave', orgId);

  void joinMeeting(String meetingId) {
    _activeMeetingId = meetingId;
    _socket?.emit('meeting:join', meetingId);
  }

  void leaveMeeting(String meetingId) {
    _activeMeetingId = null;
    _socket?.emit('meeting:leave', meetingId);
  }

  // ── Event Listeners ───────────────────────────────────
  void on(String event, Function(dynamic) handler) {
    _socket?.on(event, handler);
  }

  void off(String event, [Function(dynamic)? handler]) {
    if (handler != null) {
      _socket?.off(event, handler);
    } else {
      _socket?.off(event);
    }
  }

  void emit(String event, [dynamic data]) {
    _socket?.emit(event, data);
  }
}

final socketClient = SocketClient();
