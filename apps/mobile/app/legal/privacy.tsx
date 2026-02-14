// ============================================================
// OrgsLedger — Privacy Policy
// ============================================================

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { Colors, Spacing, FontSize, FontWeight } from '../../src/theme';
import { PoweredByFooter } from '../../src/components/ui';

const EFFECTIVE_DATE = 'January 1, 2026';

export default function PrivacyPolicyScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Privacy Policy', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textPrimary }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Privacy Policy</Text>
          <Text style={styles.effective}>Effective Date: {EFFECTIVE_DATE}</Text>
        </View>

        <Section title="1. Introduction">
          OrgsLedger Inc. ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and share your personal data when you use the OrgsLedger platform ("Platform"). This policy applies to all users globally, including those in the European Union (GDPR), Nigeria (NDPA), and other jurisdictions.
        </Section>

        <Section title="2. Data Controller">
          {`OrgsLedger Inc. is the data controller for personal data processed through the Platform.

Contact: privacy@orgsledger.com
Address: OrgsLedger Inc., Wilmington, Delaware, USA`}
        </Section>

        <Section title="3. Data We Collect">
          {`We collect the following categories of personal data:

Account Data: Name, email address, phone number, password (hashed), avatar image, role within organizations.

Organization Data: Organization name, membership records, meeting records, financial transactions (dues, fines, donations), chat messages, documents, polls, events.

Usage Data: Login timestamps, IP addresses, device information, browser/app type, feature usage patterns.

Payment Data: Billing currency, payment gateway references, transaction amounts. Full payment card details are handled by our payment processors (Stripe, Paystack, Flutterwave) and never stored on our servers.

AI Processing Data: Meeting audio (when AI transcription is enabled), translation text. Audio is processed in real-time and not permanently stored unless the organization opts to save transcripts.

Communication Data: Push notification tokens (FCM/APNs), email delivery records.`}
        </Section>

        <Section title="4. How We Use Your Data">
          {`We process your data for the following purposes:

• Service Delivery: Account management, organization operations, financial tracking, communication features.
• Security: Authentication, access control, fraud prevention, audit logging.
• AI Features: Meeting transcription, real-time translation, summarization (with explicit opt-in).
• Notifications: Push notifications, email alerts for meetings, payments, announcements.
• Analytics: Aggregated usage analytics for service improvement (no individual tracking).
• Legal Compliance: Tax reporting assistance, regulatory compliance, dispute resolution.`}
        </Section>

        <Section title="5. Legal Basis for Processing (GDPR)">
          {`For users in the EU/EEA, we process data under:

• Contract Performance: Processing necessary to provide the Platform services you subscribed to.
• Legitimate Interests: Security measures, fraud prevention, service improvement.
• Consent: AI processing of meeting audio, optional marketing communications.
• Legal Obligation: Financial record-keeping, regulatory compliance.

You may withdraw consent at any time without affecting the lawfulness of prior processing.`}
        </Section>

        <Section title="6. Data Sharing">
          {`We share personal data only in the following circumstances:

Within Organizations: Organization administrators can view member profiles, attendance, and financial records for their organization only. Multi-tenant isolation ensures organizations cannot access each other's data.

Payment Processors: Stripe, Paystack, and Flutterwave process payments on our behalf under their respective privacy policies.

AI Providers: Google Cloud (Speech-to-Text, Translation) and OpenAI process AI requests. Data is not retained by these providers for training purposes.

Legal Requirements: We may disclose data if required by law, court order, or to protect our rights and safety.

We do NOT sell personal data to third parties.`}
        </Section>

        <Section title="7. Data Retention">
          {`• Active accounts: Data retained for the duration of your account.
• Inactive accounts: Data deleted after 24 months of inactivity.
• Expired subscriptions: Organization data retained for 90 days after expiration.
• Audit logs: Retained for 7 years for compliance purposes.
• Payment records: Retained as required by applicable financial regulations.
• Deleted content: Soft-deleted for 30 days, then permanently removed.`}
        </Section>

        <Section title="8. Data Security">
          {`We implement industry-standard security measures:

• Encryption in transit (TLS 1.3) and at rest (AES-256).
• Password hashing using bcrypt with salt rounds of 12.
• JWT-based authentication with token rotation.
• Role-based access control with tenant isolation.
• Rate limiting and brute-force protection.
• Regular security audits and penetration testing.
• SQL injection prevention through parameterized queries.`}
        </Section>

        <Section title="9. Your Rights">
          {`Depending on your jurisdiction, you may have the following rights:

• Access: Request a copy of your personal data.
• Rectification: Correct inaccurate personal data.
• Erasure: Request deletion of your personal data ("right to be forgotten").
• Portability: Receive your data in a structured, machine-readable format.
• Restriction: Restrict processing of your data.
• Objection: Object to processing based on legitimate interests.
• Withdraw Consent: Withdraw consent for optional processing.

To exercise these rights, contact privacy@orgsledger.com. We will respond within 30 days.`}
        </Section>

        <Section title="10. International Data Transfers">
          Data may be transferred to and processed in the United States and other countries where our service providers operate. For EU/EEA users, we rely on Standard Contractual Clauses (SCCs) and adequacy decisions to ensure appropriate safeguards for international transfers.
        </Section>

        <Section title="11. Children's Privacy">
          The Platform is not intended for users under 18 years of age. We do not knowingly collect personal data from children. If we become aware of such collection, we will promptly delete the data.
        </Section>

        <Section title="12. Cookies & Tracking">
          The web version of the Platform uses essential cookies for session management and authentication. We do not use third-party advertising or tracking cookies. Analytics are performed using aggregated, anonymized data.
        </Section>

        <Section title="13. Nigeria Data Protection (NDPA)">
          For users in Nigeria, we comply with the Nigeria Data Protection Act 2023. Your data is processed in accordance with the principles of lawfulness, fairness, transparency, purpose limitation, data minimization, accuracy, storage limitation, integrity, and accountability.
        </Section>

        <Section title="14. Changes to This Policy">
          We may update this Privacy Policy periodically. Material changes will be communicated via email or in-app notification at least 30 days in advance.
        </Section>

        <Section title="15. Contact & Complaints">
          {`Data Protection Officer: privacy@orgsledger.com
General Inquiries: support@orgsledger.com

If you believe your privacy rights have been violated, you may file a complaint with your local data protection authority.`}
        </Section>

        <PoweredByFooter />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  header: { marginBottom: Spacing.xl },
  title: { fontSize: FontSize.title, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginBottom: Spacing.xs },
  effective: { fontSize: FontSize.sm, color: Colors.textSecondary },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.highlight, marginBottom: Spacing.sm },
  sectionBody: { fontSize: FontSize.md, color: Colors.textSecondary, lineHeight: 24 },
});
