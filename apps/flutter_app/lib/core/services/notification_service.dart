import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Singleton service for initializing and showing local notifications.
/// Wires socket events → local system notifications.
class NotificationService {
  static final NotificationService _instance = NotificationService._();
  factory NotificationService() => _instance;
  NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _initialized = false;

  /// Global navigator key – set from main.dart so we can navigate on tap.
  GlobalKey<NavigatorState>? navigatorKey;

  // Callback for handling notification taps (set from main.dart)
  void Function(String? payload)? onNotificationTap;

  Future<void> initialize() async {
    if (_initialized) return;
    // Skip on web — flutter_local_notifications does not support web
    if (kIsWeb) {
      _initialized = true;
      return;
    }

    const androidSettings = AndroidInitializationSettings(
      '@mipmap/ic_launcher',
    );

    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const macSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const linuxSettings = LinuxInitializationSettings(
      defaultActionName: 'Open',
    );

    const initSettings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
      macOS: macSettings,
      linux: linuxSettings,
    );

    await _plugin.initialize(
      settings: initSettings,
      onDidReceiveNotificationResponse: _onNotificationResponse,
    );

    // Request permissions on Android 13+
    if (!kIsWeb && Platform.isAndroid) {
      final androidPlugin = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      await androidPlugin?.requestNotificationsPermission();
    }

    // Request permissions on iOS
    if (!kIsWeb && Platform.isIOS) {
      final iosPlugin = _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >();
      await iosPlugin?.requestPermissions(
        alert: true,
        badge: true,
        sound: true,
      );
    }

    _initialized = true;
  }

  void _onNotificationResponse(NotificationResponse response) {
    final payload = response.payload;
    if (payload != null && onNotificationTap != null) {
      onNotificationTap!(payload);
    }
  }

  /// Show a notification.
  /// [payload] can be a route like `/meetings/abc123` for navigation on tap.
  Future<void> show({
    required String title,
    String? body,
    String? payload,
    int? id,
  }) async {
    if (kIsWeb || !_initialized) return;

    const androidDetails = AndroidNotificationDetails(
      'orgsledger_default',
      'OrgsLedger',
      channelDescription: 'OrgsLedger notifications',
      importance: Importance.high,
      priority: Priority.high,
      showWhen: true,
      icon: '@mipmap/ic_launcher',
    );

    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    const details = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
      macOS: iosDetails,
    );

    await _plugin.show(
      id: id ?? DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title: title,
      body: body,
      notificationDetails: details,
      payload: payload,
    );
  }

  /// Show a notification for a meeting event.
  Future<void> showMeetingNotification({
    required String title,
    String? body,
    String? meetingId,
  }) async {
    await show(
      title: title,
      body: body,
      payload: meetingId != null ? '/meetings/$meetingId' : null,
    );
  }

  /// Show a notification for a chat message.
  Future<void> showChatNotification({
    required String senderName,
    required String message,
    String? channelId,
  }) async {
    await show(
      title: senderName,
      body: message,
      payload: channelId != null ? '/chat/$channelId' : null,
    );
  }

  /// Show a generic notification.
  Future<void> showGenericNotification({
    required String title,
    String? body,
    String? route,
  }) async {
    await show(title: title, body: body, payload: route);
  }
}

/// Global singleton
final notificationService = NotificationService();
