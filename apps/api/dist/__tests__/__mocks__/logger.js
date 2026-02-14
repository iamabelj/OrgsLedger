"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
// Mock logger for unit tests — all methods are jest.fn() no-ops
exports.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};
//# sourceMappingURL=logger.js.map