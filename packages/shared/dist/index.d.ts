export declare enum UserRole {
    DEVELOPER = "developer",
    SUPER_ADMIN = "super_admin",
    ORG_ADMIN = "org_admin",
    EXECUTIVE = "executive",
    MEMBER = "member",
    GUEST = "guest"
}
export declare enum OrgStatus {
    ACTIVE = "active",
    SUSPENDED = "suspended",
    TRIAL = "trial",
    EXPIRED = "expired"
}
export interface IOrganization {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string;
    status: OrgStatus;
    subscriptionStatus: string;
    billingCurrency: string;
    settings: IOrgSettings;
    createdAt: Date;
    updatedAt: Date;
}
export interface IOrgSettings {
    currency: string;
    timezone: string;
    locale: string;
    aiEnabled: boolean;
    maxMembers: number;
    features: FeatureFlags;
}
export interface FeatureFlags {
    chat: boolean;
    meetings: boolean;
    aiMinutes: boolean;
    financials: boolean;
    donations: boolean;
    voting: boolean;
}
export interface IUser {
    id: string;
    email: string;
    phone?: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface IMembership {
    id: string;
    userId: string;
    organizationId: string;
    role: UserRole;
    joinedAt: Date;
    isActive: boolean;
    committeeIds: string[];
}
export declare enum ChannelType {
    GENERAL = "general",
    COMMITTEE = "committee",
    DIRECT = "direct",
    ANNOUNCEMENT = "announcement"
}
export interface IChannel {
    id: string;
    organizationId: string;
    name: string;
    type: ChannelType;
    description?: string;
    memberIds: string[];
    createdAt: Date;
}
export interface IMessage {
    id: string;
    channelId: string;
    senderId: string;
    content: string;
    attachments: IAttachment[];
    threadId?: string;
    isEdited: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface IAttachment {
    id: string;
    fileName: string;
    fileUrl: string;
    mimeType: string;
    sizeBytes: number;
}
export declare enum MeetingStatus {
    SCHEDULED = "scheduled",
    LIVE = "live",
    ENDED = "ended",
    CANCELLED = "cancelled"
}
export interface IMeeting {
    id: string;
    organizationId: string;
    title: string;
    description?: string;
    status: MeetingStatus;
    scheduledStart: Date;
    scheduledEnd?: Date;
    actualStart?: Date;
    actualEnd?: Date;
    createdBy: string;
    agendaItems: IAgendaItem[];
    attendeeIds: string[];
    aiEnabled: boolean;
    createdAt: Date;
}
export interface IAgendaItem {
    id: string;
    title: string;
    description?: string;
    order: number;
    duration?: number;
    presenterUserId?: string;
}
export interface IAttendance {
    id: string;
    meetingId: string;
    userId: string;
    joinedAt: Date;
    leftAt?: Date;
    status: 'present' | 'absent' | 'excused' | 'late';
}
export interface IVote {
    id: string;
    meetingId: string;
    title: string;
    description?: string;
    options: string[];
    results: Record<string, string[]>;
    status: 'open' | 'closed';
    createdAt: Date;
    closedAt?: Date;
}
export interface IMeetingMinutes {
    id: string;
    meetingId: string;
    organizationId: string;
    transcript: ITranscriptSegment[];
    summary: string;
    decisions: string[];
    motions: IMotion[];
    actionItems: IActionItem[];
    contributions: IContribution[];
    generatedAt: Date;
    aiCreditsUsed: number;
    status: 'processing' | 'completed' | 'failed';
}
export interface ITranscriptSegment {
    speakerId?: string;
    speakerName: string;
    text: string;
    startTime: number;
    endTime: number;
    language?: string;
}
export interface IMotion {
    text: string;
    movedBy?: string;
    secondedBy?: string;
    result?: 'passed' | 'failed' | 'tabled';
}
export interface IActionItem {
    description: string;
    assigneeId?: string;
    assigneeName?: string;
    dueDate?: Date;
    status: 'pending' | 'in_progress' | 'completed';
}
export interface IContribution {
    userId: string;
    userName: string;
    speakingTimeSeconds: number;
    keyPoints: string[];
}
export declare enum TransactionType {
    DUE = "due",
    FINE = "fine",
    DONATION = "donation",
    LATE_FEE = "late_fee",
    MISCONDUCT_FINE = "misconduct_fine",
    REFUND = "refund",
    AI_CREDIT_PURCHASE = "ai_credit_purchase"
}
export declare enum TransactionStatus {
    PENDING = "pending",
    COMPLETED = "completed",
    FAILED = "failed",
    REFUNDED = "refunded",
    PARTIALLY_REFUNDED = "partially_refunded"
}
export interface ITransaction {
    id: string;
    organizationId: string;
    userId: string;
    type: TransactionType;
    amount: number;
    currency: string;
    status: TransactionStatus;
    description: string;
    referenceId?: string;
    paymentGatewayId?: string;
    receiptUrl?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface IDue {
    id: string;
    organizationId: string;
    title: string;
    description?: string;
    amount: number;
    currency: string;
    dueDate: Date;
    lateFeeAmount?: number;
    lateFeeGraceDays?: number;
    isRecurring: boolean;
    recurrenceRule?: string;
    targetMemberIds: string[];
    createdBy: string;
    createdAt: Date;
}
export interface IFine {
    id: string;
    organizationId: string;
    userId: string;
    type: 'misconduct' | 'late_payment' | 'absence' | 'other';
    amount: number;
    currency: string;
    reason: string;
    issuedBy: string;
    status: 'unpaid' | 'paid' | 'waived';
    createdAt: Date;
}
export interface IDonation {
    id: string;
    organizationId: string;
    userId?: string;
    amount: number;
    currency: string;
    campaignId?: string;
    isAnonymous: boolean;
    message?: string;
    status: TransactionStatus;
    createdAt: Date;
}
export declare enum AuditAction {
    CREATE = "create",
    UPDATE = "update",
    DELETE = "delete",
    LOGIN = "login",
    LOGOUT = "logout",
    PAYMENT = "payment",
    REFUND = "refund",
    ROLE_CHANGE = "role_change",
    SETTINGS_CHANGE = "settings_change",
    AI_USAGE = "ai_usage",
    EXPORT = "export"
}
export interface IAuditLog {
    id: string;
    organizationId?: string;
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    previousValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
}
export interface IAIWallet {
    id: string;
    organizationId: string;
    balanceMinutes: number;
    currency: string;
    pricePerHourUsd: number;
    pricePerHourNgn: number;
    updatedAt: Date;
}
export interface IAIWalletTransaction {
    id: string;
    organizationId: string;
    type: 'topup' | 'usage' | 'refund' | 'grant';
    minutes: number;
    amountUsd: number;
    amountNgn: number;
    meetingId?: string;
    paymentReference?: string;
    description: string;
    createdAt: Date;
}
export declare enum PlanTier {
    STANDARD = "standard",
    PROFESSIONAL = "professional",
    ENTERPRISE = "enterprise"
}
export interface ISubscriptionPlan {
    id: string;
    name: string;
    slug: string;
    tier: PlanTier;
    maxMembers: number;
    features: FeatureFlags;
    priceMonthlyUsd: number;
    priceAnnualUsd: number;
    priceMonthlyNgn: number;
    priceAnnualNgn: number;
    isActive: boolean;
    createdAt: Date;
}
export interface ISubscription {
    id: string;
    organizationId: string;
    planId: string;
    status: string;
    billingCycle: 'monthly' | 'annual';
    currency: string;
    amountPaid: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    gracePeriodEnd: Date;
    createdAt: Date;
}
export declare enum NotificationType {
    MESSAGE = "message",
    MEETING = "meeting",
    PAYMENT = "payment",
    FINE = "fine",
    DUE_REMINDER = "due_reminder",
    MINUTES_READY = "minutes_ready",
    SYSTEM = "system"
}
export interface INotification {
    id: string;
    userId: string;
    organizationId?: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    isRead: boolean;
    createdAt: Date;
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
    };
}
export interface PaginatedRequest {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    search?: string;
}
export * from './languages';
//# sourceMappingURL=index.d.ts.map