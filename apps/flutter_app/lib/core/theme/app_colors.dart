import 'package:flutter/material.dart';

/// OrgsLedger Royal Design System — Colors
class AppColors {
  AppColors._();

  // ── Core Palette ──────────────────────────────────────
  static const primary = Color(0xFF0B1426);
  static const primaryLight = Color(0xFF132039);
  static const primaryMid = Color(0xFF1A2744);
  static const accent = Color(0xFF1E3054);

  // ── Gold / Highlight ──────────────────────────────────
  static const highlight = Color(0xFFC9A84C);
  static const highlightLight = Color(0xFFD4BF7A);
  static const highlightDark = Color(0xFFA68B3C);
  static const highlightSubtle = Color(0x1FC9A84C); // 12% opacity

  // ── Status Colors ─────────────────────────────────────
  static const success = Color(0xFF2ECC71);
  static const successDark = Color(0xFF1B7A4E);
  static const successSubtle = Color(0x1F2ECC71);
  static const warning = Color(0xFFE67E22);
  static const warningSubtle = Color(0x1FE67E22);
  static const error = Color(0xFFC0392B);
  static const danger = error;
  static const dangerSubtle = Color(0x1FC0392B);
  static const info = Color(0xFF2980B9);
  static const infoSubtle = Color(0x1F2980B9);

  // ── Surfaces ──────────────────────────────────────────
  static const background = Color(0xFF060D18);
  static const surface = Color(0xFF0F1A2E);
  static const surfaceElevated = Color(0xFF162040);
  static const surfaceAlt = Color(0xFF1A2744);
  static const surfaceHover = Color(0xFF1E2D4A);

  // ── Borders ───────────────────────────────────────────
  static const border = Color(0xFF1E3054);
  static const borderLight = Color(0xFF162040);
  static const borderGold = Color(0x4DC9A84C); // 30% opacity

  // ── Text ──────────────────────────────────────────────
  static const textPrimary = Color(0xFFF0EDE5);
  static const textSecondary = Color(0xFF8E99A9);
  static const textLight = Color(0xFF5A6A7E);
  static const textWhite = Color(0xFFFFFFFF);
  static const textGold = Color(0xFFC9A84C);

  // ── Status Aliases ────────────────────────────────────
  static const pending = Color(0xFFE67E22);
  static const completed = Color(0xFF2ECC71);
  static const failed = Color(0xFFC0392B);
  static const refunded = Color(0xFF8E44AD);

  // ── Overlay ───────────────────────────────────────────
  static const overlay = Color(0xB3060D18); // 70%
  static const overlayLight = Color(0x66060D18); // 40%
}
