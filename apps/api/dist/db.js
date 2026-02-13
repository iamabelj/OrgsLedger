"use strict";
// ============================================================
// OrgsLedger API — Database Connection
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
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
        max: 10,
        afterCreate: (conn, done) => {
            conn.query('SELECT 1', (err) => {
                if (err) {
                    logger_1.logger.error('Database connection failed', { error: err.message });
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
    // Log but don't crash — let the fallback server handle diagnostics
    logger_1.logger.error('App will continue but database queries will fail');
});
exports.default = exports.db;
//# sourceMappingURL=db.js.map