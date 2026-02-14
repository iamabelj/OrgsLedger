// ============================================================
// OrgsLedger — Acceptable Use Policy (AUP)
// ============================================================

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { Colors, Spacing, FontSize, FontWeight } from '../../src/theme';
import { PoweredByFooter } from '../../src/components/ui';

const EFFECTIVE_DATE = 'January 1, 2026';

export default function AUPScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Acceptable Use Policy', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textPrimary }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Acceptable Use Policy</Text>
          <Text style={styles.effective}>Effective Date: {EFFECTIVE_DATE}</Text>
        </View>

        <Section title="1. Purpose">
          This Acceptable Use Policy ("AUP") defines the permitted and prohibited uses of the OrgsLedger platform. It supplements our Terms of Service and applies to all users, organizations, and administrators.
        </Section>

        <Section title="2. Permitted Use">
          {`OrgsLedger is designed for legitimate organizational management including:

• Professional, religious, community, and civic organizations
• Alumni associations and social clubs
• Non-profit organizations and NGOs
• Trade unions and cooperative societies
• Educational institutions and student organizations
• Corporate departments and teams

Organizations may use the platform for membership management, financial tracking, communications, meetings, document sharing, and other organizational operations.`}
        </Section>

        <Section title="3. Prohibited Activities">
          {`The following activities are strictly prohibited:

Financial Misconduct:
• Money laundering or facilitating proceeds of crime
• Operating a Ponzi or pyramid scheme
• Processing payments for illegal goods or services
• Tax evasion or facilitating tax fraud
• Misrepresenting financial records or transactions

Security Violations:
• Attempting to bypass authentication or access controls
• Exploiting vulnerabilities in the platform
• Reverse engineering, decompiling, or disassembling the software
• Sharing login credentials with unauthorized parties
• Using automated tools to probe or attack the platform

Content Violations:
• Uploading illegal, harmful, or offensive content
• Distributing malware, viruses, or ransomware
• Sharing pirated or copyright-infringing material
• Storing personally identifiable information of non-members without consent
• Harassment, hate speech, or discriminatory content

Platform Abuse:
• Creating fake organizations or accounts
• Abusing free trial or promotional offers
• Exceeding member limits through circumvention
• Reselling or sub-licensing platform access without authorization
• Using AI features to generate harmful, misleading, or illegal content
• Automated bulk operations designed to degrade service quality`}
        </Section>

        <Section title="4. Organization Administrator Responsibilities">
          {`Organization administrators are additionally responsible for:

• Ensuring all organization members comply with this AUP
• Properly onboarding and offboarding members
• Maintaining accurate financial records
• Securing organization-level settings and configurations
• Promptly reporting any security incidents or policy violations
• Obtaining proper consent for AI-enabled features (transcription, translation)
• Managing and reviewing audit logs regularly`}
        </Section>

        <Section title="5. Financial Compliance">
          {`Organizations using financial features must:

• Comply with all applicable anti-money laundering (AML) regulations
• Maintain proper records for tax and audit purposes
• Ensure dues, fines, and donations are authorized by organizational governance
• Not use the platform as a substitute for licensed financial services
• Report suspicious financial activity to appropriate authorities`}
        </Section>

        <Section title="6. Data Handling">
          {`All users must:

• Handle personal data in accordance with applicable privacy laws
• Not export or copy member data for unauthorized purposes
• Report data breaches immediately to organization administrators
• Respect data retention policies and deletion requests
• Not use member contact information for unsolicited marketing`}
        </Section>

        <Section title="7. Enforcement">
          {`Violations of this AUP may result in:

• Warning notification to the organization administrator
• Temporary suspension of the offending account
• Suspension of the entire organization's access
• Permanent account or organization termination
• Reporting to law enforcement if illegal activity is involved

We reserve the right to investigate suspected violations and take action without prior notice in cases of severe or ongoing violations.`}
        </Section>

        <Section title="8. Reporting Violations">
          {`To report a violation of this AUP, contact:
Email: abuse@orgsledger.com

We will investigate all reports in confidence and respond within 5 business days.`}
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
