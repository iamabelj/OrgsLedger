import { Request, Response } from 'express';
export declare class NotificationController {
    /** GET / — list current user's notifications */
    list(req: Request, res: Response): Promise<void>;
    /** PUT /:id/read — mark single notification as read */
    markRead(req: Request, res: Response): Promise<void>;
    /** PUT /read-all — mark all notifications as read */
    markAllRead(req: Request, res: Response): Promise<void>;
}
export declare const notificationController: NotificationController;
//# sourceMappingURL=notification.controller.d.ts.map