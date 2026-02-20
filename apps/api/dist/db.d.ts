import Knex from 'knex';
export declare const db: Knex.Knex<any, unknown[]>;
export declare function tableExists(tableName: string): Promise<boolean>;
/** Call after creating a table at runtime to update cache */
export declare function markTableExists(tableName: string): void;
export default db;
//# sourceMappingURL=db.d.ts.map