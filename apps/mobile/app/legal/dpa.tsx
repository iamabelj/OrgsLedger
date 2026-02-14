// ============================================================
// OrgsLedger — Data Processing Agreement (DPA)
// ============================================================

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { Colors, Spacing, FontSize, FontWeight } from '../../src/theme';
import { PoweredByFooter } from '../../src/components/ui';

const EFFECTIVE_DATE = 'January 1, 2026';

export default function DPAScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Data Processing Agreement', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textPrimary }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Data Processing Agreement</Text>
          <Text style={styles.effective}>Effective Date: {EFFECTIVE_DATE}</Text>
        </View>

        <Section title="1. Scope & Purpose">
          This Data Processing Agreement ("DPA") supplements the OrgsLedger Terms of Service and governs the processing of personal data by OrgsLedger Inc. ("Processor") on behalf of the subscribing organization ("Controller"). This DPA applies when the Controller uses OrgsLedger to process personal data of its members and stakeholders.
        </Section>

        <Section title="2. Definitions">
          {`"Personal Data" means any information relating to an identified or identifiable natural person as defined under GDPR Article 4(1) and the Nigeria Data Protection Act 2023.

"Processing" means any operation performed on Personal Data, including collection, storage, retrieval, use, disclosure, erasure, or destruction.

"Sub-processor" means any third party engaged by the Processor to assist in processing Personal Data.`}
        </Section>

        <Section title="3. Processing Details">
          {`Subject Matter: Organizational membership management, financial operations, communications, and meeting management.

Duration: For the term of the subscription agreement plus the data retention period.

Nature & Purpose: Storing and processing member records, financial transactions, chat messages, meeting data, documents, and related organizational data to provide the Platform services.

Categories of Data Subjects: Organization members, administrators, executives, guests.

Types of Personal Data: Names, email addresses, phone numbers, financial transaction records, attendance records, chat messages, documents, audio recordings (when AI features enabled).`}
        </Section>

        <Section title="4. Processor Obligations">
          {`The Processor shall:

a) Process Personal Data only on documented instructions from the Controller, unless required by law.
b) Ensure persons authorized to process data are bound by confidentiality obligations.
c) Implement appropriate technical and organizational security measures.
d) Not engage Sub-processors without prior written consent of the Controller.
e) Assist the Controller in responding to data subject requests (access, rectification, erasure, portability).
f) Assist the Controller in ensuring compliance with security, breach notification, impact assessments, and prior consultation obligations.
g) Delete or return all Personal Data upon termination of services, at the Controller's choice.
h) Make available all information necessary to demonstrate compliance and allow for audits.`}
        </Section>

        <Section title="5. Sub-processors">
          {`The Controller provides general authorization for the following Sub-processors:

• Amazon Web Services (AWS) — Cloud infrastructure and hosting
• Neon.tech — PostgreSQL database hosting
• Google Cloud Platform — AI transcription and translation services
• OpenAI — AI summarization and analysis features
• Stripe — Payment processing (US/international)
• Paystack — Payment processing (Nigeria/Africa)
• Flutterwave — Payment processing (Africa/global)
• Firebase Cloud Messaging — Push notifications

The Processor shall notify the Controller at least 30 days before adding or replacing Sub-processors. The Controller may object to new Sub-processors within 14 days of notification.`}
        </Section>

        <Section title="6. Security Measures">
          {`The Processor implements the following technical and organizational measures:

Technical Measures:
• TLS 1.3 encryption for data in transit
• AES-256 encryption for data at rest
• Bcrypt password hashing (12 salt rounds)
• JWT token authentication with rotation
• Multi-tenant data isolation at the database level
• Rate limiting and DDoS protection
• SQL injection prevention via parameterized queries
• Regular automated security scanning

Organizational Measures:
• Role-based access control
• Comprehensive audit logging
• Incident response procedures
• Staff confidentiality agreements
• Regular security training`}
        </Section>

        <Section title="7. Data Breach Notification">
          The Processor shall notify the Controller without undue delay (and within 72 hours of becoming aware) of any Personal Data breach. Notification shall include the nature of the breach, categories and approximate number of data subjects affected, likely consequences, and measures taken to mitigate the breach.
        </Section>

        <Section title="8. International Transfers">
          When Personal Data is transferred outside the EEA or Nigeria, the Processor ensures appropriate safeguards through Standard Contractual Clauses (SCCs) or other lawful transfer mechanisms.
        </Section>

        <Section title="9. Data Subject Rights">
          The Processor shall assist the Controller in fulfilling data subject requests within the timeframes required by applicable law (30 days under GDPR, 72 hours for urgent requests under NDPA).
        </Section>

        <Section title="10. Term & Termination">
          This DPA remains in effect for the duration of the subscription. Upon termination, the Processor shall, at the Controller's election, return or delete all Personal Data within 30 days, unless retention is required by law.
        </Section>

        <Section title="11. Governing Law">
          This DPA shall be governed by the laws applicable to the Terms of Service. For EU Controllers, this DPA is additionally governed by GDPR. For Nigerian Controllers, this DPA is additionally governed by the NDPA 2023.
        </Section>

        <Section title="12. Contact">
          {`Data Protection Officer: dpo@orgsledger.com
Legal Department: legal@orgsledger.com`}
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
