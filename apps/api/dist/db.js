"use strict";
// ============================================================
// OrgsLedger API — Database Connection (Optimized)
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.tableExists = tableExists;
exports.markTableExists = markTableExists;
const knex_1 = __importDefault(require("knex"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const connection = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: config_1.config.db.host,
        port: config_1.config.db.port,
        user: config_1.config.db.user,
        password: config_1.config.db.password,
        database: config_1.config.db.database,
    };
exports.db = (0, knex_1.default)({
    client: 'pg',
    connection,
    pool: {
        min: 2,
        max: 20, // ↑ from 10 — prevents pool exhaustion under load
        acquireTimeoutMillis: 30000, // Fail fast if pool is exhausted (30s)
        createTimeoutMillis: 10000, // Don't hang forever creating connections
        idleTimeoutMillis: 30000, // Release idle connections after 30s
        reapIntervalMillis: 1000, // Check for idle connections every 1s
        propagateCreateError: false, // Don't crash on transient connection errors
        afterCreate: (conn, done) => {
            // Set statement timeout to 30s to prevent runaway queries
            conn.query('SET statement_timeout = 30000', (err) => {
                if (err) {
                    logger_1.logger.error('Database connection setup failed', { error: err.message });
                }
                done(err, conn);
            });
        },
    },
});
// Test connection on startup
exports.db.raw('SELECT 1')
    .then(() => logger_1.logger.info('Database connected successfully'))
    .catch((err) => {
    logger_1.logger.error('Database connection failed on startup', { error: err.message });
    logger_1.logger.error('App will continue but database queries will fail');
});
// ── Table Existence Cache ────────────────────────────────
// Avoids expensive db.schema.hasTable() calls on every request
const tableExistsCache = new Map();
async function tableExists(tableName) {
    const cached = tableExistsCache.get(tableName);
    if (cached !== undefined)
        return cached;
    const exists = await exports.db.schema.hasTable(tableName);
    tableExistsCache.set(tableName, exists);
    return exists;
}
/** Call after creating a table at runtime to update cache */
function markTableExists(tableName) {
    tableExistsCache.set(tableName, true);
}
exports.default = exports.db;
//# sourceMappingURL=db.js.map