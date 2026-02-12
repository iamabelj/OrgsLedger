// ============================================================
// OrgsLedger Mobile — Change Password Screen
// ============================================================

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';
import { api } from '../src/api/client';
import { Colors, Spacing, FontSize, FontWeight } from '../src/theme';
import { Card, Button, Input, SectionHeader } from '../src/components/ui';
import { showAlert } from '../src/utils/alert';

export default function ChangePasswordScreen() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showAlert('Error', 'All fields are required');
      return;
    }
    if (newPassword.length < 8) {
      showAlert('Error', 'New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await api.auth.changePassword({ currentPassword, newPassword });
      showAlert('Success', 'Password changed successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Change Password',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.highlight,
          headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
          headerShadowVisible: false,
        }}
      />
      <Card style={styles.card}>
        <SectionHeader title="Update Your Password" />
        <Input
          label="Current Password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Enter current password"
          secureTextEntry
          icon="lock-closed-outline"
        />
        <Input
          label="New Password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Min 8 characters"
          secureTextEntry
          icon="key-outline"
        />
        <Input
          label="Confirm New Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Re-enter new password"
          secureTextEntry
          icon="key-outline"
        />
        <View style={{ height: Spacing.sm }} />
        <Button
          title={loading ? 'Changing...' : 'Change Password'}
          onPress={handleChange}
          disabled={loading}
          variant="primary"
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { margin: Spacing.md, padding: Spacing.md, gap: Spacing.sm },
});
