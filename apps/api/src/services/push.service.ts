// ============================================================
// OrgsLedger API — Push Notification Service
// Firebase Cloud Messaging (FCM) v1 HTTP API
// ============================================================

import { config } from '../config';
import { logger } from '../logger';
import db from '../db';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// FCM v1 API requires a service account access token.
// Set GOOGLE_APPLICATION_CREDENTIALS env var pointing to your
// Firebase service account JSON, and FIREBASE_PROJECT_ID.

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Get an OAuth2 access token for FCM v1 API using a service account.
 */
async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  if (config.ai.googleCredentials) {
    try {
      const { GoogleAuth } = await import('google-auth-library');
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
    } catch (err) {
      logger.warn('Failed to get FCM v1 access token, push notifications disabled', err);
    }
  }

  return null;
}

function getProjectId(): string | null {
  return process.env.FIREBASE_PROJECT_ID || null;
}

/**
 * Send push notification to a specific user.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  try {
    const user = await db('users')
      .where({ id: userId })
      .select('fcm_token', 'apns_token')
      .first();

    if (!user?.fcm_token && !user?.apns_token) {
      return;
    }

    if (user.fcm_token) {
      await sendFCM(user.fcm_token, payload);
    }
  } catch (err) {
    logger.error('Push notification failed', { userId, err });
  }
}

/**
 * Send push notification to all members of an organization.
 */
export async function sendPushToOrg(
  organizationId: string,
  payload: PushPayload,
  excludeUserId?: string
): Promise<void> {
  try {
    let query = db('memberships')
      .join('users', 'memberships.user_id', 'users.id')
      .where({ 'memberships.organization_id': organizationId, 'memberships.is_active': true })
      .whereNotNull('users.fcm_token');

    if (excludeUserId) {
      query = query.whereNot('users.id', excludeUserId);
    }

    const users = await query.select('users.id', 'users.fcm_token');

    for (const user of users) {
      await sendFCM(user.fcm_token, payload);
    }
  } catch (err) {
    logger.error('Org push notification failed', { organizationId, err });
  }
}

async function sendFCM(token: string, payload: PushPayload): Promise<void> {
  const projectId = getProjectId();
  const accessToken = await getAccessToken();

  if (!accessToken || !projectId) {
    logger.debug('FCM not configured (no service account or project ID), skipping push');
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
      logger.error('FCM v1 send failed', { status: response.status, body: errBody });

      // If token is invalid, remove it
      if (response.status === 404 || response.status === 400) {
        await db('users').where({ fcm_token: token }).update({ fcm_token: null });
        logger.info('Removed invalid FCM token');
      }
    }
  } catch (err) {
    logger.error('FCM request failed', err);
  }
}
