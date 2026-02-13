"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const knex_1 = __importDefault(require("knex"));
const knexfile_1 = __importDefault(require("./knexfile"));
async function migrate() {
    const db = (0, knex_1.default)(knexfile_1.default);
    try {
        console.log('Running migrations...');
        const [batch, migrations] = await db.migrate.latest({
            directory: __dirname + '/migrations',
        });
        if (migrations.length === 0) {
            console.log('Already up to date.');
        }
        else {
            console.log(`Batch ${batch}: ${migrations.length} migrations applied.`);
            migrations.forEach((m) => console.log(`  ✓ ${m}`));
        }
    }
    catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
    finally {
        await db.destroy();
    }
}
migrate();
//# sourceMappingURL=migrate.js.map