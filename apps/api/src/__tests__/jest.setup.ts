import db from '../db';

afterAll(async () => {
  try {
    // Ensure Knex's pool/timers are cleaned up so Jest can exit naturally.
    await db.destroy();
  } catch {
    // Ignore double-destroy or teardown races in individual test files.
  }
});
