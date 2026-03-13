"use strict";
// ============================================================
// OrgsLedger API — Super Admin Auto-Seed Service
// ============================================================
// Ensures the platform super admin account exists on startup.
// Reads credentials from DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD
// environment variables. Skips silently if env vars are not set
// or if the account already exists.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSuperAdmin = ensureSuperAdmin;
exports.ensureDeveloperConsoleAccount = ensureDeveloperConsoleAccount;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const logger_1 = require("../logger");
const BCRYPT_ROUNDS = 12;
const ELEVATED_ROLES = new Set(['developer', 'super_admin']);
async function ensureSuperAdmin() {
    const email = process.env.DEFAULT_ADMIN_EMAIL;
    const password = process.env.DEFAULT_ADMIN_PASSWORD;
    if (!email || !password) {
        logger_1.logger.debug('[SEED] DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD not set — skipping auto-seed');
        return;
    }
    try {
        const existing = await (0, db_1.db)('users').where({ email }).first();
        if (existing) {
            // Ensure the account is active and has the correct role
            if (!existing.is_active || existing.global_role !== 'super_admin') {
                await (0, db_1.db)('users').where({ id: existing.id }).update({
                    is_active: true,
                    global_role: 'super_admin',
                    email_verified: true,
                });
                logger_1.logger.info(`[SEED] Super admin account reactivated: ${email}`);
            }
            // If password changed, update it
            const passwordMatch = await bcryptjs_1.default.compare(password, existing.password_hash);
            if (!passwordMatch) {
                const newHash = await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS);
                await (0, db_1.db)('users').where({ id: existing.id }).update({ password_hash: newHash });
                logger_1.logger.info(`[SEED] Super admin password updated: ${email}`);
            }
            return;
        }
        // Create the super admin account
        const passwordHash = await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS);
        await (0, db_1.db)('users').insert({
            email,
            password_hash: passwordHash,
            first_name: 'Platform',
            last_name: 'Admin',
            global_role: 'super_admin',
            email_verified: true,
            is_active: true,
        });
        logger_1.logger.info(`[SEED] Super admin account created: ${email}`);
        // Auto-join the first organization if one exists
        const firstOrg = await (0, db_1.db)('organizations').orderBy('created_at', 'asc').first();
        if (firstOrg) {
            const adminUser = await (0, db_1.db)('users').where({ email }).first();
            if (adminUser) {
                const existingMembership = await (0, db_1.db)('memberships')
                    .where({ user_id: adminUser.id, organization_id: firstOrg.id })
                    .first();
                if (!existingMembership) {
                    await (0, db_1.db)('memberships').insert({
                        user_id: adminUser.id,
                        organization_id: firstOrg.id,
                        role: 'org_admin',
                        is_active: true,
                        joined_at: db_1.db.fn.now(),
                    });
                    logger_1.logger.info(`[SEED] Super admin joined org: ${firstOrg.name}`);
                }
            }
        }
    }
    catch (err) {
        // Don't crash the server if seeding fails (e.g., users table doesn't exist yet)
        logger_1.logger.warn(`[SEED] Auto-seed skipped: ${err.message}`);
    }
}
async function ensureDeveloperConsoleAccount() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
        logger_1.logger.debug('[SEED] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping developer console bootstrap');
        return;
    }
    const normalizedEmail = email.toLowerCase().trim();
    try {
        const existing = await (0, db_1.db)('users').whereRaw('LOWER(email) = LOWER(?)', [normalizedEmail]).first();
        if (existing) {
            if (!ELEVATED_ROLES.has(existing.global_role)) {
                logger_1.logger.warn(`[SEED] Developer console bootstrap skipped: ${normalizedEmail} already exists with non-elevated role ${existing.global_role}`);
                return;
            }
            const updates = {};
            if (!existing.is_active) {
                updates.is_active = true;
            }
            if (!existing.email_verified) {
                updates.email_verified = true;
            }
            if (Object.keys(updates).length > 0) {
                await (0, db_1.db)('users').where({ id: existing.id }).update(updates);
                logger_1.logger.info(`[SEED] Developer console account refreshed: ${normalizedEmail}`);
            }
            else {
                logger_1.logger.info(`[SEED] Developer console account verified: ${normalizedEmail}`);
            }
            return;
        }
        await (0, db_1.db)('users').insert({
            email: normalizedEmail,
            password_hash: await bcryptjs_1.default.hash(password, BCRYPT_ROUNDS),
            first_name: 'Platform',
            last_name: 'Developer',
            global_role: 'developer',
            email_verified: true,
            is_active: true,
        });
        logger_1.logger.info(`[SEED] Developer console account created: ${normalizedEmail}`);
    }
    catch (err) {
        logger_1.logger.warn(`[SEED] Developer console bootstrap skipped: ${err.message}`);
    }
}
//# sourceMappingURL=seed.service.js.map