// Mock config for unit tests
export const config = {
  env: 'test',
  port: 3000,
  apiUrl: 'http://localhost:3000',
  db: {
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  },
  jwt: {
    secret: 'test-jwt-secret-for-unit-tests',
    expiresIn: '1h',
    refreshExpiresIn: '7d',
  },
  upload: {
    dir: './uploads',
    maxFileSizeMB: 50,
  },
  ai: {
    openaiApiKey: '',
    googleCredentials: '',
  },
  aiProxy: {
    url: '',
    apiKey: '',
  },
};
