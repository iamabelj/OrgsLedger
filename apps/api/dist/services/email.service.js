"use strict";
// ============================================================
// OrgsLedger API — Email Service
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
exports.sendDueReminderEmail = sendDueReminderEmail;
exports.sendFineIssuedEmail = sendFineIssuedEmail;
exports.sendAnnouncementEmail = sendAnnouncementEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
const logger_1 = require("../logger");
/** Escape user input before interpolating into HTML */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
let transporter = null;
function getTransporter() {
    if (!transporter) {
        const isSSL = config_1.config.email.port === 465;
        transporter = nodemailer_1.default.createTransport({
            host: config_1.config.email.host,
            port: config_1.config.email.port,
            secure: isSSL, // true for 465 (SSL), false for 587 (STARTTLS)
            auth: {
                user: config_1.config.email.user,
                pass: config_1.config.email.pass,
            },
            tls: {
                rejectUnauthorized: true, // enforce valid certificates
            },
        });
    }
    return transporter;
}
async function sendEmail(options) {
    try {
        if (!config_1.config.email.host) {
            logger_1.logger.warn('SMTP not configured, email not sent', { to: options.to, subject: options.subject });
            return false;
        }
        const transport = getTransporter();
        await transport.sendMail({
            from: config_1.config.email.from,
            to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
            attachments: options.attachments,
        });
        logger_1.logger.info('Email sent', { to: options.to, subject: options.subject });
        return true;
    }
    catch (err) {
        logger_1.logger.error('Failed to send email', err);
        return false;
    }
}
/**
 * Send due/fine reminder emails.
 */
async function sendDueReminderEmail(dueTitle, amount, currency, dueDate, recipientEmail) {
    const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const urgencyColor = daysUntilDue <= 3 ? '#E74C3C' : daysUntilDue <= 7 ? '#F39C12' : '#2980B9';
    const urgencyLabel = daysUntilDue <= 0 ? 'OVERDUE' : `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0B1426; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #C9A84C; margin: 0; font-size: 24px;">OrgsLedger</h1>
      </div>
      <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px;">
        <div style="background: ${urgencyColor}; color: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
          <p style="margin: 0; font-size: 14px; opacity: 0.9;">Payment Due Reminder</p>
          <p style="margin: 8px 0; font-size: 18px; font-weight: bold;">${urgencyLabel}</p>
        </div>
        <h2 style="color: #0B1426; margin-top: 0;">${escapeHtml(dueTitle)}</h2>
        <div style="background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0;">
          <p style="margin: 8px 0; color: #555;"><strong>Amount Due:</strong> ${currency} ${amount.toFixed(2)}</p>
          <p style="margin: 8px 0; color: #555;"><strong>Due Date:</strong> ${dueDate.toLocaleDateString()}</p>
          <a href="https://app.orgsledger.com" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: ${urgencyColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Make Payment</a>
        </div>
        <p style="color: #888; font-size: 12px; margin-top: 16px;">
          Please settle this payment to avoid late fees.
        </p>
      </div>
      <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 16px;">&copy; ${new Date().getFullYear()} OrgsLedger. All rights reserved.</p>
    </div>
  `;
    await sendEmail({
        to: recipientEmail,
        subject: `Payment Reminder: ${escapeHtml(dueTitle)} - ${urgencyLabel}`,
        html,
    });
}
/**
 * Send fine issued email.
 */
async function sendFineIssuedEmail(reason, amount, currency, recipientEmail) {
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0B1426; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #C9A84C; margin: 0; font-size: 24px;">OrgsLedger</h1>
      </div>
      <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px;">
        <div style="background: #E74C3C; color: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
          <p style="margin: 0; font-size: 14px; opacity: 0.9;">⚠️ Fine Issued</p>
        </div>
        <h2 style="color: #0B1426; margin-top: 0;">Fine Assessment</h2>
        <div style="background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0;">
          <p style="margin: 8px 0; color: #555;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
          <p style="margin: 8px 0; color: #555;"><strong>Amount:</strong> <span style="color: #E74C3C; font-weight: bold;">${currency} ${amount.toFixed(2)}</span></p>
          <p style="margin: 12px 0; color: #888; font-size: 13px;">This fine has been added to your account. You can view details and make payment in the app.</p>
          <a href="https://app.orgsledger.com" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #E74C3C; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">View Fine Details</a>
        </div>
        <p style="color: #888; font-size: 12px; margin-top: 16px;">
          If you believe this is an error, contact your organization's administrator.
        </p>
      </div>
      <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 16px;">&copy; ${new Date().getFullYear()} OrgsLedger. All rights reserved.</p>
    </div>
  `;
    await sendEmail({
        to: recipientEmail,
        subject: 'Fine Issued - Action Required',
        html,
    });
}
/**
 * Send announcement email to group of users.
 */
async function sendAnnouncementEmail(title, body, priority, recipientEmails) {
    const priorityColors = {
        low: { bg: '#AEB6BF', text: 'Low Priority' },
        normal: { bg: '#2980B9', text: 'Standard' },
        high: { bg: '#F39C12', text: 'High Priority' },
        urgent: { bg: '#E74C3C', text: 'Urgent' }
    };
    const style = priorityColors[priority] || priorityColors.normal;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0B1426; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #C9A84C; margin: 0; font-size: 24px;">OrgsLedger</h1>
      </div>
      <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px;">
        <div style="background: ${style.bg}; color: white; padding: 12px; border-radius: 6px; margin-bottom: 24px; text-align: center;">
          <p style="margin: 4px 0; font-size: 12px; opacity: 0.9; text-transform: uppercase; font-weight: bold;">📢 ${style.text}</p>
        </div>
        <h2 style="color: #0B1426; margin-top: 0; font-size: 20px;">${escapeHtml(title)}</h2>
        <div style="background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0; line-height: 1.6;">
          ${escapeHtml(body).replace(/\n/g, '<br/>')}
        </div>
        <a href="https://app.orgsledger.com" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: ${style.bg}; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">View in App</a>
        <p style="color: #888; font-size: 12px; margin-top: 16px;">
          You're receiving this because you're a member of the organization.
        </p>
      </div>
      <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 16px;">&copy; ${new Date().getFullYear()} OrgsLedger. All rights reserved.</p>
    </div>
  `;
    await sendEmail({
        to: recipientEmails,
        subject: `${priority === 'urgent' ? '🔴 URGENT: ' : ''}${escapeHtml(title)}`,
        html,
    });
}
//# sourceMappingURL=email.service.js.map