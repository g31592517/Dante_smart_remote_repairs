import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const blankToUndefined = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.url().default('http://localhost:5173'),
  API_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().default('dante'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('dante_dev'),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  COOKIE_SECURE: bool,

  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(10),

  EMAIL_TRANSPORT: z.enum(['smtp', 'log']).default('log'),
  EMAIL_FROM: z.string().default('Dante Smart Remote Repairs <no-reply@example.com>'),
  SMTP_HOST: blankToUndefined,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: blankToUndefined,
  SMTP_PASSWORD: blankToUndefined,

  SMS_PROVIDER: blankToUndefined,
  SMS_API_KEY: blankToUndefined,
  WHATSAPP_PROVIDER: blankToUndefined,
  WHATSAPP_API_TOKEN: blankToUndefined,

  ANYDESK_API_URL: z.url().default('https://v1.api.anydesk.com:8081'),
  ANYDESK_LICENSE_ID: blankToUndefined,
  ANYDESK_API_PASSWORD: blankToUndefined,

  PAYMENT_GATEWAY: z.enum(['none', 'stripe']).default('none'),
  /** unpaid online/transfer orders are cancelled (and their stock released) after this many hours */
  ORDER_PAYMENT_TIMEOUT_HOURS: z.coerce.number().int().min(1).default(72),
  STRIPE_SECRET_KEY: blankToUndefined,
  STRIPE_WEBHOOK_SECRET: blankToUndefined,
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET.startsWith('replace-with')) throw new Error('Set a real JWT_SECRET in production');
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production (serve over HTTPS)');
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) throw new Error('SMTP_HOST is required when EMAIL_TRANSPORT=smtp');
  }
  if (env.PAYMENT_GATEWAY === 'stripe' && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) {
    throw new Error('PAYMENT_GATEWAY=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
  }
  return env;
}

export const env = load();
export const isTest = env.NODE_ENV === 'test';
export const isProd = env.NODE_ENV === 'production';
