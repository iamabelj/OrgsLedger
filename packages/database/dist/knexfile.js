"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connection = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5433,
        user: process.env.DB_USER || 'orgsledger',
        password: process.env.DB_PASSWORD || 'orgsledger_dev',
        database: process.env.DB_NAME || 'orgsledger',
    };
const config = {
    client: 'pg',
    connection,
    pool: { min: 2, max: 20 },
    migrations: {
        directory: './migrations',
        extension: 'ts',
    },
    seeds: {
        directory: './seeds',
        extension: 'ts',
    },
};
exports.default = config;
//# sourceMappingURL=knexfile.js.map