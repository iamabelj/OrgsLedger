import { Request, Response, NextFunction } from 'express';
export declare class MeetingController {
    /**
     * POST /meetings/create
     * Create a new meeting
     */
    create(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/create-with-visibility
     * Create a new meeting with role-segmented visibility.
     * Supports ALL_MEMBERS, EXECUTIVES, COMMITTEE, or CUSTOM visibility types.
     */
    createWithVisibility(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * PATCH /meetings/:id
     * Update a scheduled meeting
     */
    update(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/join
     * Join an existing meeting
     */
    join(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/leave
     * Leave a meeting
     */
    leave(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /meetings/:id
     * Get meeting details
     */
    getById(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /meetings
     * List meetings for an organization
     */
    list(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/:id/start
     * Start a scheduled meeting
     */
    start(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/:id/end
     * End an active meeting
     */
    end(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/:id/cancel
     * Cancel a scheduled meeting
     */
    cancel(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/:id/token
     * Generate LiveKit token for joining meeting media
     */
    getToken(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * GET /meetings/:id/minutes
     * Get AI-generated meeting minutes
     * Requires authentication + meeting access
     * Only invited participants can view minutes (unless visibility is ALL_MEMBERS)
     */
    getMinutes(req: Request, res: Response, next: NextFunction): Promise<void>;
    /**
     * POST /meetings/:id/minutes/regenerate
     * Force regeneration of meeting minutes (admin/host only)
     * Requires authentication + host/admin role
     */
    regenerateMinutes(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const meetingController: MeetingController;
//# sourceMappingURL=meeting.controller.d.ts.map