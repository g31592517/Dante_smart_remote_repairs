// Runs before every test file (and before any app module is imported).
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME ?? 'dante_test';
process.env.DB_USER = process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'dante';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? 'dante_dev_pw';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.STORAGE_DIR = './test-storage';
process.env.EMAIL_TRANSPORT = 'log';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.ANYDESK_LICENSE_ID = '';
process.env.ANYDESK_API_PASSWORD = '';
process.env.PAYMENT_GATEWAY = 'none';
export {};
