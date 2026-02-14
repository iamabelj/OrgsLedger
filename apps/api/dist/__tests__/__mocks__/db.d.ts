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
    fn: {
        now: jest.Mock;
        uuid: jest.Mock;
    };
    transaction: jest.Mock;
    [key: string]: any;
};
declare function createQueryBuilder(): MockQueryBuilder;
declare const db: any;
export default db;
export { createQueryBuilder };
//# sourceMappingURL=db.d.ts.map