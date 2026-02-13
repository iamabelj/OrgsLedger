// ============================================================
// OrgsLedger — Cross-Platform Date/Time Picker
// ============================================================

import React, { useState } from 'react';
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

  const formatValue = (date: Date) => {
    if (!hasValue) return mode === 'date' ? 'Select date' : 'Select time';
    return mode === 'date' ? format(date, 'MMM d, yyyy') : format(date, 'h:mm a');
  };

  const getInputValue = (date: Date) => {
    if (mode === 'date') {
      // YYYY-MM-DD format for HTML5 date input
      return format(date, 'yyyy-MM-dd');
    } else {
      // HH:mm format for HTML5 time input
      return format(date, 'HH:mm');
    }
  };

  const handleWebChange = (inputValue: string) => {
    if (!inputValue) return;

    try {
      if (mode === 'date') {
        // Parse YYYY-MM-DD
        const [year, month, day] = inputValue.split('-').map(Number);
        if (isNaN(year) || isNaN(month) || isNaN(day)) return;
        const newDate = new Date(value);
        newDate.setFullYear(year, month - 1, day);
        if (!isNaN(newDate.getTime())) onChange(newDate);
      } else {
        // Parse HH:mm
        const [hours, minutes] = inputValue.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return;
        const newDate = new Date(value);
        newDate.setHours(hours, minutes, 0, 0);
        if (!isNaN(newDate.getTime())) onChange(newDate);
      }
    } catch {
      // Ignore parse errors
    }
  };

  // Web implementation using native HTML5 date/time input
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.webInputContainer}>
          <Ionicons
            name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
            size={16}
            color={Colors.highlight}
          />
          <input
            type={mode === 'date' ? 'date' : 'time'}
            value={getInputValue(value)}
            onChange={(e: any) => {
              const v = e.target?.value || e.nativeEvent?.text;
              if (v) handleWebChange(v);
            }}
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: Colors.textWhite,
              fontSize: 14,
              fontFamily: 'inherit',
              padding: '4px 0',
              colorScheme: 'dark',
              cursor: 'pointer',
              minHeight: '24px',
            } as any}
          />
        </View>
      </View>
    );
  }

  // Native implementation
  const handleNativeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (selectedDate) {
      onChange(selectedDate);
    }
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
          {formatValue(value)}
        </Text>
      </TouchableOpacity>

      {/* iOS Modal Picker */}
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

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.sm,
  },
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
  webInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  webInput: {
    flex: 1,
    color: Colors.textWhite,
    fontSize: FontSize.md,
    outlineStyle: 'none' as any,
    borderWidth: 0,
    backgroundColor: 'transparent',
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
