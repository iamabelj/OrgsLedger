"use strict";
// ============================================================
// OrgsLedger API — Push Notification Service
// Firebase Cloud Messaging (FCM) v1 HTTP API
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushToUser = sendPushToUser;
exports.sendPushToOrg = sendPushToOrg;
const config_1 = require("../config");
const logger_1 = require("../logger");
const db_1 = __importDefault(require("../db"));
// FCM v1 API requires a service account access token.
// Set GOOGLE_APPLICATION_CREDENTIALS env var pointing to your
// Firebase service account JSON, and FIREBASE_PROJECT_ID.
let cachedAccessToken = null;
/**
 * Get an OAuth2 access token for FCM v1 API using a service account.
 */
async function getAccessToken() {
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
        return cachedAccessToken.token;
    }
    if (config_1.config.ai.googleCredentials) {
        try {
            const { GoogleAuth } = await Promise.resolve().then(() => __importStar(require('google-auth-library')));
            const auth = new GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
            });
            const client = await auth.getClient();
            const tokenResponse = await client.getAccessToken();
            if (tokenResponse.token) {
                cachedAccessToken = {
                    token: tokenResponse.token,
                    expiresAt: Date.now() + 50 * 60 * 1000,
                };
                return tokenResponse.token;
            }
        }
        catch (err) {
            logger_1.logger.warn('Failed to get FCM v1 access token, push notifications disabled', err);
        }
    }
    return null;
}
function getProjectId() {
    return process.env.FIREBASE_PROJECT_ID || null;
}
/**
 * Send push notification to a specific user.
 */
async function sendPushToUser(userId, payload) {
    try {
        const user = await (0, db_1.default)('users')
            .where({ id: userId })
            .select('fcm_token', 'apns_token')
            .first();
        if (!user?.fcm_token && !user?.apns_token) {
            return;
        }
        if (user.fcm_token) {
            await sendFCM(user.fcm_token, payload);
        }
    }
    catch (err) {
        logger_1.logger.error('Push notification failed', { userId, err });
    }
}
/**
 * Send push notification to all members of an organization.
 */
async function sendPushToOrg(organizationId, payload, excludeUserId) {
    try {
        let query = (0, db_1.default)('memberships')
            .join('users', 'memberships.user_id', 'users.id')
            .where({ 'memberships.organization_id': organizationId, 'memberships.is_active': true })
            .whereNotNull('users.fcm_token');
        if (excludeUserId) {
            query = query.whereNot('users.id', excludeUserId);
        }
        const users = await query.select('users.id', 'users.fcm_token');
        // Send in parallel batches of 10
        const BATCH_SIZE = 10;
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(batch.map((user) => sendFCM(user.fcm_token, payload)));
        }
    }
    catch (err) {
        logger_1.logger.error('Org push notification failed', { organizationId, err });
    }
}
async function sendFCM(token, payload) {
    const projectId = getProjectId();
    const accessToken = await getAccessToken();
    if (!accessToken || !projectId) {
        logger_1.logger.debug('FCM not configured (no service account or project ID), skipping push');
        return;
    }
    try {
        const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: {
                    token,
                    notification: {
                        title: payload.title,
                        body: payload.body,
                    },
                    data: payload.data || {},
                    android: {
                        priority: 'high',
                        notification: {
                            sound: 'default',
                            channelId: 'orgsledger_default',
                        },
                    },
                    apns: {
                        payload: {
                            aps: {
                                sound: 'default',
                                badge: 1,
                            },
                        },
                    },
                },
            }),
        });
        if (!response.ok) {
            const errBody = await response.text();
            logger_1.logger.error('FCM v1 send failed', { status: response.status, body: errBody });
            // If token is invalid, remove it
            if (response.status === 404 || response.status === 400) {
                await (0, db_1.default)('users').where({ fcm_token: token }).update({ fcm_token: null });
                logger_1.logger.info('Removed invalid FCM token');
            }
        }
    }
    catch (err) {
        logger_1.logger.error('FCM request failed', err);
    }
}
//# sourceMappingURL=push.service.js.map