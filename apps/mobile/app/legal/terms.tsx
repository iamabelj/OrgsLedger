// ============================================================
// OrgsLedger — Terms of Service
// ============================================================

import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { PoweredByFooter } from '../../src/components/ui';

const EFFECTIVE_DATE = 'January 1, 2026';

export default function TermsOfServiceScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Terms of Service', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textPrimary }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Terms of Service</Text>
          <Text style={styles.effective}>Effective Date: {EFFECTIVE_DATE}</Text>
        </View>

        <Section title="1. Acceptance of Terms">
          By accessing or using OrgsLedger ("the Platform"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Platform. OrgsLedger is operated by OrgsLedger Inc. ("we", "us", "our").
        </Section>

        <Section title="2. Description of Service">
          OrgsLedger is a cross-border organizational infrastructure platform providing tools for membership management, financial operations (dues, fines, donations, ledger), real-time communication (chat, meetings with AI transcription and translation), document management, polling, event scheduling, and administrative dashboards. The Platform operates as a Software-as-a-Service (SaaS) with tiered subscription plans.
        </Section>

        <Section title="3. Account Registration">
          You must provide accurate, complete, and current information when creating an account. You are responsible for safeguarding your password and for all activities that occur under your account. You must be at least 18 years old or the age of majority in your jurisdiction to use the Platform. Organizations are responsible for ensuring their members comply with these Terms.
        </Section>

        <Section title="4. Subscription Plans & Billing">
          {`The Platform offers several subscription tiers (Standard, Professional, Enterprise, Enterprise Pro). Pricing is available in USD and NGN. Subscriptions renew automatically unless cancelled. A 7-day grace period applies after subscription expiration before access is restricted.

• Payments are processed via Stripe, Paystack, or Flutterwave depending on your region.
• All fees are non-refundable except as required by law or at our sole discretion.
• We reserve the right to modify pricing with 30 days' notice.
• AI and Translation wallet top-ups are prepaid and non-refundable once used.`}
        </Section>

        <Section title="5. Acceptable Use">
          {`You agree not to:
• Use the Platform for any unlawful purpose or in violation of any applicable laws.
• Upload malicious code, viruses, or any harmful content.
• Attempt to gain unauthorized access to other accounts or systems.
• Use automated tools to scrape, crawl, or extract data from the Platform.
• Interfere with or disrupt the Platform's infrastructure.
• Impersonate any person or entity.
• Transmit spam, phishing attempts, or unsolicited communications.
• Use the Platform to launder money or facilitate fraud.`}
        </Section>

        <Section title="6. Financial Operations">
          {`Organizations using financial features (dues collection, fines, donations, expense tracking) are solely responsible for:
• Compliance with local tax laws and financial regulations.
• Accurate record-keeping and reporting.
• Proper authorization of financial transactions within their organization.
• Ensuring all payment methods comply with applicable regulations.

OrgsLedger is not a financial institution and does not provide banking, lending, or investment services. We act solely as a technology platform facilitating organizational financial management.`}
        </Section>

        <Section title="7. Data Ownership & Content">
          {`You retain all rights to content you upload to the Platform. By using the Platform, you grant us a limited license to store, process, and display your content solely for the purpose of providing the service.

Organization administrators are responsible for managing access to organizational data. When an organization's subscription expires, data is retained for 90 days before being subject to deletion.`}
        </Section>

        <Section title="8. AI Services">
          {`AI-powered features (meeting transcription, translation, summarization) are provided on a best-effort basis. AI outputs may contain errors and should be reviewed by users. AI services consume wallet credits which are metered per use.

We do not use your organizational data to train AI models. AI processing is performed using third-party providers (Google Cloud, OpenAI) subject to their respective terms and privacy policies.`}
        </Section>

        <Section title="9. Privacy & Data Protection">
          Your use of the Platform is also governed by our Privacy Policy. We process personal data in accordance with applicable data protection laws including GDPR and NDPA (Nigeria Data Protection Act).
        </Section>

        <Section title="10. Intellectual Property">
          The Platform, including all software, designs, logos, and documentation, is owned by OrgsLedger Inc. and protected by intellectual property laws. Your subscription grants you a limited, non-exclusive, non-transferable license to use the Platform.
        </Section>

        <Section title="11. Service Availability">
          We strive for 99.9% uptime but do not guarantee uninterrupted availability. Scheduled maintenance will be communicated in advance. We are not liable for downtime caused by factors beyond our control.
        </Section>

        <Section title="12. Termination">
          {`We may suspend or terminate your account if:
• You violate these Terms.
• Your subscription payment fails and the grace period expires.
• Your organization engages in fraudulent or illegal activity.

Upon termination, you may request export of your data within 30 days.`}
        </Section>

        <Section title="13. Limitation of Liability">
          To the maximum extent permitted by law, OrgsLedger Inc. shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform. Our total liability shall not exceed the amount paid by you in the 12 months preceding the claim.
        </Section>

        <Section title="14. Dispute Resolution">
          Any disputes shall first be addressed through good-faith negotiation. If unresolved, disputes shall be submitted to binding arbitration in the State of Delaware, USA. These Terms are governed by the laws of the State of Delaware.
        </Section>

        <Section title="15. Changes to Terms">
          We may update these Terms from time to time. Material changes will be communicated via email or Platform notification at least 30 days prior to taking effect. Continued use of the Platform after changes constitutes acceptance.
        </Section>

        <Section title="16. Contact">
          {`For questions about these Terms, contact us at:
Email: legal@orgsledger.com
Website: https://orgsledger.com`}
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
