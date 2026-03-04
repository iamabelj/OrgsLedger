export interface EmailOptions {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: Array<{
        filename: string;
        content: string | Buffer;
        contentType?: string;
    }>;
}
export declare function sendEmail(options: EmailOptions): Promise<boolean>;
/**
 * Send meeting minutes via email to all attendees.
 */
export declare function sendMeetingMinutesEmail(meetingTitle: string, minutesSummary: string, recipientEmails: string[]): Promise<void>;
/**
 * Send meeting reminder emails (24h, 1h, or 15min before).
 */
export declare function sendMeetingReminderEmail(meetingTitle: string, scheduledStart: Date, timeframe: '24h' | '1h' | '15min', recipientEmails: string[]): Promise<void>;
/**
 * Send email when meeting starts.
 */
export declare function sendMeetingStartedEmail(meetingTitle: string, recipientEmails: string[]): Promise<void>;
/**
 * Send due/fine reminder emails.
 */
export declare function sendDueReminderEmail(dueTitle: string, amount: number, currency: string, dueDate: Date, recipientEmail: string): Promise<void>;
/**
 * Send fine issued email.
 */
export declare function sendFineIssuedEmail(reason: string, amount: number, currency: string, recipientEmail: string): Promise<void>;
/**
 * Send announcement email to group of users.
 */
export declare function sendAnnouncementEmail(title: string, body: string, priority: 'low' | 'normal' | 'high' | 'urgent', recipientEmails: string[]): Promise<void>;
//# sourceMappingURL=email.service.d.ts.map