// ============================================================
// OrgsLedger — Help & Support Screen
// ============================================================

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius,
} from '../src/theme';
import { Card, SectionHeader, Divider, ResponsiveScrollView } from '../src/components/ui';
import { PoweredByFooter } from '../src/components/ui';

const FAQ_ITEMS = [
  {
    q: 'How do I invite members to my organization?',
    a: 'Go to Admin → Invite Members and share the generated invite link or code with your members.',
  },
  {
    q: 'How do I pay my dues?',
    a: 'Go to Financials → select the due → tap Pay. You can pay via card, bank transfer, or wallet balance.',
  },
  {
    q: 'How do I create a meeting?',
    a: 'Go to Meetings → tap "Create Meeting". Fill in the details and invite participants.',
  },
  {
    q: 'Can I switch between organizations?',
    a: 'Yes! Go to Profile → Organizations section and tap on your desired organization.',
  },
  {
    q: 'How does AI transcription work?',
    a: 'During meetings, AI can transcribe and translate conversations in real-time. Your admin needs to enable AI credits from the subscription dashboard.',
  },
  {
    q: 'How do I change my password?',
    a: 'Go to Profile → Settings → Change Password.',
  },
];

export default function HelpScreen() {
  const openEmail = () => Linking.openURL('mailto:support@orgsledger.com').catch(() => {});
  const openSales = () => Linking.openURL('mailto:sales@orgsledger.com?subject=OrgsLedger%20Sales%20Inquiry').catch(() => {});
  const openDocs = () => Linking.openURL('https://orgsledger.com/docs').catch(() => {});

  return (
    <>
      <Stack.Screen options={{ title: 'Help & Support', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
      <ResponsiveScrollView style={styles.container}>
        {/* Header */}
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="help-buoy" size={56} color={Colors.highlight} />
          </View>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSub}>
            Find answers, contact support, or explore our documentation.
          </Text>
        </View>

        {/* Quick Actions */}
        <Card style={styles.card}>
          <SectionHeader title="Get Help" />
          <HelpAction
            icon="mail" color={Colors.info} bg={Colors.infoSubtle}
            label="Email Support" desc="support@orgsledger.com"
            onPress={openEmail}
          />
          <HelpAction
            icon="book" color={Colors.highlight} bg={Colors.highlightSubtle}
            label="Documentation" desc="Guides & tutorials"
            onPress={openDocs}
          />
          <HelpAction
            icon="chatbubble-ellipses" color={Colors.success} bg={Colors.successSubtle}
            label="Community Chat" desc="Join the community"
            onPress={() => Linking.openURL('https://orgsledger.com/community').catch(() => {})}
          />
          <HelpAction
            icon="cash" color={Colors.highlight} bg={Colors.highlightSubtle}
            label="Contact Sales" desc="sales@orgsledger.com"
            onPress={openSales}
            last
          />
        </Card>

        {/* FAQ */}
        <Card style={styles.card}>
          <SectionHeader title="Frequently Asked Questions" />
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem key={i} question={item.q} answer={item.a} last={i === FAQ_ITEMS.length - 1} />
          ))}
        </Card>

        {/* Quick Links */}
        <Card style={styles.card}>
          <SectionHeader title="Legal & Policies" />
          <LinkRow icon="document-text" label="Terms of Service" onPress={() => router.push('/legal/terms')} />
          <LinkRow icon="shield-checkmark" label="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
          <LinkRow icon="briefcase" label="Data Processing Agreement" onPress={() => router.push('/legal/dpa')} />
          <LinkRow icon="hand-left" label="Acceptable Use Policy" onPress={() => router.push('/legal/acceptable-use')} last />
        </Card>

        {/* App Info */}
        <Card style={styles.card}>
          <SectionHeader title="About" />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>1.0.0</Text>
          </View>
          <Divider />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Platform</Text>
            <Text style={styles.aboutValue}>OrgsLedger SaaS</Text>
          </View>
          <Divider />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Website</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://orgsledger.com').catch(() => {})}>
              <Text style={[styles.aboutValue, { color: Colors.highlight }]}>orgsledger.com</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <PoweredByFooter />
        <View style={{ height: Spacing.xxl * 2 }} />
      </ResponsiveScrollView>
    </>
  );
}

function HelpAction({ icon, color, bg, label, desc, onPress, last }: { icon: string; color: string; bg: string; label: string; desc: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity
      style={[haStyles.row, !last && haStyles.border]}
      onPress={onPress} activeOpacity={0.7}
    >
      <View style={[haStyles.iconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={haStyles.label}>{label}</Text>
        <Text style={haStyles.desc}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

function FAQItem({ question, answer, last }: { question: string; answer: string; last?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <TouchableOpacity
      style={[faqStyles.row, !last && faqStyles.border]}
      onPress={() => setOpen(!open)} activeOpacity={0.7}
    >
      <View style={faqStyles.header}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={Colors.highlight} />
        <Text style={faqStyles.question}>{question}</Text>
      </View>
      {open && <Text style={faqStyles.answer}>{answer}</Text>}
    </TouchableOpacity>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[lrStyles.row, !last && lrStyles.border]} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon as any} size={18} color={Colors.textLight} />
      <Text style={lrStyles.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

const haStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  iconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
  desc: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 1 },
});

const faqStyles = StyleSheet.create({
  row: { paddingVertical: Spacing.md },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  question: { flex: 1, fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
  answer: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm, marginLeft: Spacing.xl, lineHeight: 20 },
});

const lrStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm + 4 },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  label: { flex: 1, fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  heroTitle: { fontSize: FontSize.title, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  heroSub: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
  card: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, padding: Spacing.lg },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs + 2 },
  aboutLabel: { fontSize: FontSize.md, color: Colors.textLight },
  aboutValue: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
});
