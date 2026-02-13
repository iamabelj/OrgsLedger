// ============================================================
// OrgsLedger — Cross-Platform Date/Time Picker
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

export function CrossPlatformDateTimePicker({
  label,
  value,
  mode,
  hasValue,
  onChange,
  style,
}: CrossPlatformDateTimePickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  const formatDisplay = (date: Date) => {
    if (!hasValue) return mode === 'date' ? 'Select date' : 'Select time';
    return mode === 'date' ? format(date, 'MMM d, yyyy') : format(date, 'h:mm a');
  };

  const getWebValue = useCallback((date: Date) => {
    if (mode === 'date') {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  }, [mode]);

  const parseWebInput = useCallback((raw: string): Date | null => {
    if (!raw) return null;
    try {
      if (mode === 'date') {
        const parts = raw.split('-').map(Number);
        if (parts.length < 3 || parts.some(isNaN)) return null;
        const [year, month, day] = parts;
        const d = new Date(value);
        d.setFullYear(year, month - 1, day);
        return isNaN(d.getTime()) ? null : d;
      }
      const parts = raw.split(':').map(Number);
      if (parts.length < 2 || parts.some(isNaN)) return null;
      const [hours, minutes] = parts;
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      const d = new Date(value);
      d.setHours(hours, minutes, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }, [mode, value]);

  // ── Web: transparent native <input> overlaid on styled container ──
  if (Platform.OS === 'web') {
    const inputVal = getWebValue(value);

    const handleInputEvent = useCallback((e: any) => {
      const v = e?.target?.value ?? e?.nativeEvent?.text ?? '';
      if (!v) return;
      const parsed = parseWebInput(v);
      if (parsed) onChange(parsed);
    }, [parseWebInput, onChange]);

    return (
      <View style={[styles.container, style]}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.webInputWrapper}>
          <Ionicons
            name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
            size={16}
            color={Colors.highlight}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.webDisplayText, !hasValue && { color: Colors.textLight }]}>
            {formatDisplay(value)}
          </Text>
          {/* Transparent overlay native HTML input – always captures clicks */}
          <input
            type={mode === 'date' ? 'date' : 'time'}
            value={inputVal}
            onChange={handleInputEvent}
            onInput={handleInputEvent}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              height: '100%',
              opacity: 0.01,
              cursor: 'pointer',
              zIndex: 10,
              border: 'none',
              margin: 0,
              padding: 0,
              boxSizing: 'border-box',
            } as any}
          />
        </View>
      </View>
    );
  }

  // ── Native implementation ─────────────────────────────
  const handleNativeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (selectedDate) onChange(selectedDate);
  };

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
          {formatDisplay(value)}
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
  webInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    position: 'relative' as any,
    overflow: 'hidden' as any,
    minHeight: 48,
  },
  webDisplayText: {
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
