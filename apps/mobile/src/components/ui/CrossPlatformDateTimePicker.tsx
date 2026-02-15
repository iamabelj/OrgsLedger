// ============================================================
// OrgsLedger — Cross-Platform Date/Time Picker
// Uses a VISIBLE native HTML <input> on web for maximum
// browser compatibility. No invisible overlay tricks.
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../theme';

interface CrossPlatformDateTimePickerProps {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  hasValue: boolean;
  onChange: (date: Date) => void;
  style?: any;
}

// ── Web-only component (rendered via dangerouslySetInnerHTML-free approach) ──
function WebDatePicker({ label, value, mode, hasValue, onChange, style }: CrossPlatformDateTimePickerProps) {
  const getInputValue = useCallback(() => {
    if (mode === 'date') {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const h = String(value.getHours()).padStart(2, '0');
    const min = String(value.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  }, [value, mode]);

  const handleChange = useCallback((e: any) => {
    // Handle both React synthetic events and native DOM events
    const raw = e?.target?.value || e?.nativeEvent?.text || '';
    if (!raw) return;

    try {
      if (mode === 'date') {
        const parts = raw.split('-').map(Number);
        if (parts.length < 3 || parts.some(isNaN)) return;
        const [year, month, day] = parts;
        const newDate = new Date(value);
        newDate.setFullYear(year, month - 1, day);
        if (!isNaN(newDate.getTime())) onChange(newDate);
      } else {
        const parts = raw.split(':').map(Number);
        if (parts.length < 2 || parts.some(isNaN)) return;
        const [hours, minutes] = parts;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return;
        const newDate = new Date(value);
        newDate.setHours(hours, minutes, 0, 0);
        if (!isNaN(newDate.getTime())) onChange(newDate);
      }
    } catch {
      // Silently ignore parse errors
    }
  }, [mode, value, onChange]);

  const displayText = hasValue
    ? (mode === 'date' ? format(value, 'MMM d, yyyy') : format(value, 'h:mm a'))
    : (mode === 'date' ? 'Select date' : 'Select time');

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.webContainer}>
        <Ionicons
          name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
          size={18}
          color={Colors.highlight}
          style={{ marginRight: 10 }}
        />
        <Text style={[styles.webDisplayLabel, !hasValue && { color: Colors.textLight }]}>
          {displayText}
        </Text>
        {/*
          Direct visible HTML input — the ONLY reliable approach for web.
          Styled with colorScheme: 'dark' so the browser renders a dark date picker.
          The input is fully visible and clickable — no opacity tricks.
        */}
        <input
          type={mode === 'date' ? 'date' : 'time'}
          value={getInputValue()}
          onChange={handleChange}
          style={{
            background: 'transparent',
            color: Colors.highlight,
            border: `1px solid ${Colors.accent}`,
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '14px',
            fontFamily: 'inherit',
            cursor: 'pointer',
            outline: 'none',
            colorScheme: 'dark',
            minWidth: mode === 'date' ? '160px' : '120px',
            marginLeft: 'auto',
          } as any}
        />
      </View>
    </View>
  );
}

export function CrossPlatformDateTimePicker(props: CrossPlatformDateTimePickerProps) {
  const { label, value, mode, hasValue, onChange, style } = props;
  const [showPicker, setShowPicker] = useState(false);

  // ── Web: use dedicated WebDatePicker ──
  if (Platform.OS === 'web') {
    return <WebDatePicker {...props} />;
  }

  // ── Native implementation ─────────────────────────────
  const handleNativeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (selectedDate) onChange(selectedDate);
  };

  const displayText = hasValue
    ? (mode === 'date' ? format(value, 'MMM d, yyyy') : format(value, 'h:mm a'))
    : (mode === 'date' ? 'Select date' : 'Select time');

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.dateBtn}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
          size={16}
          color={Colors.highlight}
        />
        <Text style={{ color: hasValue ? Colors.textWhite : Colors.textLight, flex: 1 }}>
          {displayText}
        </Text>
      </TouchableOpacity>

      {Platform.OS === 'ios' ? (
        <Modal transparent visible={showPicker} animationType="slide">
          <View style={styles.pickerModal}>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text style={styles.pickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={value}
                mode={mode}
                display="spinner"
                themeVariant="dark"
                is24Hour={mode === 'time'}
                onChange={handleNativeChange}
              />
            </View>
          </View>
        </Modal>
      ) : (
        showPicker && (
          <DateTimePicker
            value={value}
            mode={mode}
            display="default"
            is24Hour={mode === 'time'}
            onChange={handleNativeChange}
          />
        )
      )}
    </View>
  );
}

export default CrossPlatformDateTimePicker;

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.sm },
  label: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
    marginBottom: 4,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  webContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    minHeight: 48,
  },
  webDisplayLabel: {
    color: Colors.textWhite,
    fontSize: FontSize.md,
    flex: 1,
  },
  pickerModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  pickerContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingBottom: 30,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: Spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  pickerDone: {
    color: Colors.highlight,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
  },
});
