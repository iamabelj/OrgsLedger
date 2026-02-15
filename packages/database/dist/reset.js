"use strict";
// ============================================================
// OrgsLedger — Complete Database Reset
// Drops ALL tables and recreates schema from scratch
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const knex_1 = __importDefault(require("knex"));
const knexfile_1 = __importDefault(require("./knexfile"));
async function reset() {
    const db = (0, knex_1.default)(knexfile_1.default);
    try {
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║     OrgsLedger — Database Reset              ║');
        console.log('╚══════════════════════════════════════════════╝');
        // Get all existing tables
        const tables = await db.raw(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
        if (tables.rows.length > 0) {
            console.log(`\nFound ${tables.rows.length} tables:`);
            tables.rows.forEach((r) => console.log(`  - ${r.tablename}`));
            // Drop everything with CASCADE
            console.log('\nDropping all tables...');
            await db.raw('DROP SCHEMA public CASCADE');
            await db.raw('CREATE SCHEMA public');
            await db.raw('GRANT ALL ON SCHEMA public TO public');
            console.log('✓ All tables dropped. Schema recreated.');
        }
        else {
            console.log('\nDatabase is already empty.');
        }
        // Verify
        const remaining = await db.raw(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
    `);
        console.log(`\nVerification: ${remaining.rows.length} tables remaining (should be 0)`);
    }
    catch (err) {
        console.error('Reset failed:', err);
        process.exit(1);
    }
    finally {
        await db.destroy();
    }
}
reset();
//# sourceMappingURL=reset.js.map