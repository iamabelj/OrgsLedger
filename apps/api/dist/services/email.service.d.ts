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
//# sourceMappingURL=email.service.d.ts.map