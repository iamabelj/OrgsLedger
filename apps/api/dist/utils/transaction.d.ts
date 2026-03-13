import { Knex } from 'knex';
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
export declare function withTransaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
/**
 * Acquire an advisory lock within a transaction (PostgreSQL).
 * Useful for coordinating state changes across concurrent requests.
 * The lock is automatically released when the transaction ends.
 *
 * @param trx - Knex transaction
 * @param lockKey - Numeric lock key (use hash of entity ID)
 */
export declare function advisoryLock(trx: Knex.Transaction, lockKey: number): Promise<void>;
/**
 * Hash a string (e.g. meeting ID) to a 32-bit integer for use as an advisory lock key.
 */
export declare function hashToLockKey(id: string): number;
//# sourceMappingURL=transaction.d.ts.map