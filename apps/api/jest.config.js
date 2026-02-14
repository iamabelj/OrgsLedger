/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  collectCoverageFrom: [
    'src/services/subscription.service.ts',
    'src/middleware/subscription.ts',
    'src/middleware/auth.ts',
    'src/middleware/rbac.ts',
    'src/middleware/index.ts',
  ],
  coverageThreshold: {
    './src/middleware/': {
      branches: 80,
      functions: 50,
      lines: 95,
      statements: 95,
    },
    './src/services/subscription.service.ts': {
      branches: 50,
      functions: 50,
      lines: 70,
      statements: 70,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
  },
  clearMocks: true,
};
