/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  collectCoverageFrom: [
    'src/services/subscription.service.ts',
    'src/middleware/subscription.ts',
    'src/middleware/auth.ts',
    'src/middleware/rbac.ts',
    'src/middleware/index.ts',
    'src/utils/file-validation.ts',
  ],
  coverageThreshold: {
    './src/middleware/': {
      branches: 85,
      functions: 60,
      lines: 95,
      statements: 95,
    },
    './src/services/subscription.service.ts': {
      branches: 60,
      functions: 60,
      lines: 75,
      statements: 75,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
  },
  clearMocks: true,
};
