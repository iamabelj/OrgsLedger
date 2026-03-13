"use strict";
// ============================================================
// OrgsLedger API — Transaction Helper
// Wraps multiple DB operations in a Knex transaction for
// atomicity. Works with the existing Knex instance.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTransaction = withTransaction;
exports.advisoryLock = advisoryLock;
exports.hashToLockKey = hashToLockKey;
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
/**
 * Execute a callback within a database transaction.
 * If the callback throws, the transaction is rolled back.
 * If it succeeds, the transaction is committed.
 *
 * @example
 * const result = await withTransaction(async (trx) => {
 *   const [org] = await trx('organizations').insert({...}).returning('*');
 *   await trx('memberships').insert([...]);
 *   return org;
 * });
 */
async function withTransaction(callback) {
    const trx = await db_1.default.transaction();
    try {
        const result = await callback(trx);
        await trx.commit();
        return result;
    }
    catch (err) {
        await trx.rollback();
        logger_1.logger.error('[TXN] Transaction rolled back', err);
        throw err;
    }
}
/**
 * Acquire an advisory lock within a transaction (PostgreSQL).
 * Useful for coordinating state changes across concurrent requests.
 * The lock is automatically released when the transaction ends.
 *
 * @param trx - Knex transaction
 * @param lockKey - Numeric lock key (use hash of entity ID)
 */
async function advisoryLock(trx, lockKey) {
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockKey]);
}
/**
 * Hash a string (e.g. meeting ID) to a 32-bit integer for use as an advisory lock key.
 */
function hashToLockKey(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        const char = id.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}
//# sourceMappingURL=transaction.js.map