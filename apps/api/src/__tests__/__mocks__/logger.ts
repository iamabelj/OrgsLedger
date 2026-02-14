// Mock logger for unit tests — all methods are jest.fn() no-ops
export const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
