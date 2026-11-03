import pino from 'pino';
import { env, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    // never log credentials or tokens
    paths: [
      'req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.password_hash', '*.token',
      '*.refreshToken', '*.accessToken', '*.STRIPE_SECRET_KEY', '*.ANYDESK_API_PASSWORD',
    ],
    censor: '[redacted]',
  },
  ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
});
