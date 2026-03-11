// ============================================================
// OrgsLedger API — Transaction Helper
// Wraps multiple DB operations in a Knex transaction for
// atomicity. Works with the existing Knex instance.
// ============================================================

import db from '../db';
import { Knex } from 'knex';
import { logger } from '../logger';

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
export async function withTransaction<T>(
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  const trx = await db.transaction();
  try {
    const result = await callback(trx);
    await trx.commit();
    return result;
  } catch (err) {
    await trx.rollback();
    logger.error('[TXN] Transaction rolled back', err);
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
export async function advisoryLock(trx: Knex.Transaction, lockKey: number): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockKey]);
}

/**
 * Hash a string (e.g. meeting ID) to a 32-bit integer for use as an advisory lock key.
 */
export function hashToLockKey(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
