// Mock database (knex) for unit tests
// Returns chainable query builder mock

type MockQueryBuilder = {
  where: jest.Mock;
  whereIn: jest.Mock;
  orderBy: jest.Mock;
  first: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  del: jest.Mock;
  returning: jest.Mock;
  select: jest.Mock;
  count: jest.Mock;
  forUpdate: jest.Mock;
  raw: jest.Mock;
  join: jest.Mock;
  leftJoin: jest.Mock;
  pluck: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  onConflict: jest.Mock;
  ignore: jest.Mock;
  merge: jest.Mock;
  clone: jest.Mock;
  clear: jest.Mock;
  andWhere: jest.Mock;
  whereNull: jest.Mock;
  fn: { now: jest.Mock; uuid: jest.Mock };
  transaction: jest.Mock;
  [key: string]: any;
};

function createQueryBuilder(): MockQueryBuilder {
  const builder: any = {};
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
  return builder as MockQueryBuilder;
}

const qb = createQueryBuilder();

// db('table') returns a fresh query builder
const db: any = jest.fn((_table: string) => {
  // Reset chain for each call
  const chain = createQueryBuilder();
  // Store the table for test inspection
  chain.__table = _table;
  return chain;
});

// db.fn.now(), db.fn.uuid(), db.raw()
db.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn().mockReturnValue('uuid') };
db.raw = jest.fn((...args: any[]) => args);
db.transaction = jest.fn();

export default db;
export { createQueryBuilder };
