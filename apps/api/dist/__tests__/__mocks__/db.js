"use strict";
// Mock database (knex) for unit tests
// Returns chainable query builder mock
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQueryBuilder = createQueryBuilder;
function createQueryBuilder() {
    const builder = {};
    const methods = [
        'where', 'whereIn', 'orderBy', 'first', 'insert', 'update', 'del',
        'returning', 'select', 'count', 'forUpdate', 'raw', 'join', 'leftJoin',
        'pluck', 'limit', 'offset', 'onConflict', 'ignore', 'merge', 'clone',
        'clear', 'andWhere', 'whereNull',
    ];
    for (const m of methods) {
        builder[m] = jest.fn().mockReturnValue(builder);
    }
    builder.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn().mockReturnValue('uuid') };
    builder.transaction = jest.fn();
    return builder;
}
const qb = createQueryBuilder();
// db('table') returns a fresh query builder
const db = jest.fn((_table) => {
    // Reset chain for each call
    const chain = createQueryBuilder();
    // Store the table for test inspection
    chain.__table = _table;
    return chain;
});
// db.fn.now(), db.fn.uuid(), db.raw()
db.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn().mockReturnValue('uuid') };
db.raw = jest.fn((...args) => args);
db.transaction = jest.fn();
exports.default = db;
//# sourceMappingURL=db.js.map