import { Router, type Request, type Response } from 'express';
import {
  acceptInviteSchema, changePasswordSchema, forgotPasswordSchema, loginSchema, refreshSchema, registerSchema, resetPasswordSchema,
  type AuthTokens,
} from '@dante/shared';
import { env } from '../../config/env.js';
import { authenticate, requireAuth } from '../../core/auth.js';
import { forbidden, unauthenticated } from '../../core/errors.js';
import { created, ok, parse } from '../../core/http.js';
import { requestContext } from '../../core/audit.js';
import * as auth from './auth.service.js';

const COOKIE = 'dante_rt';
const COOKIE_PATH = '/api/v1/auth';

/**
 * Browsers receive the refresh token as an httpOnly, SameSite=Strict cookie scoped to /api/v1/auth, so
 * page scripts can never read it. Native/mobile clients send `X-Client: mobile` and receive it in the body.
 */
function isMobile(req: Request) {
  return req.get('x-client') === 'mobile';
}
function sendTokens(req: Request, res: Response, tokens: { accessToken: string; accessTokenExpiresIn: number; refreshToken: string }): AuthTokens {
  if (isMobile(req)) return tokens;
  res.cookie(COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  return { accessToken: tokens.accessToken, accessTokenExpiresIn: tokens.accessTokenExpiresIn };
}
function readRefreshToken(req: Request): string | undefined {
  const body = parse(refreshSchema, req.body ?? {});
  if (body.refreshToken) return body.refreshToken;
  const cookie = req.cookies?.[COOKIE] as string | undefined;
  if (cookie) {
    // Cookie-authenticated request: insist the browser origin is one of ours (defence in depth over SameSite).
    const origin = req.get('origin');
    const allowed = env.CORS_ORIGINS.split(',').map((o) => o.trim());
    if (origin && !allowed.includes(origin)) throw forbidden('Origin not allowed');
  }
  return cookie;
}

export function authRoutes(limiter: (req: Request, res: Response, next: () => void) => void) {
  const r = Router();

  r.post('/register', limiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    const { user, tokens } = await auth.register(input, requestContext(req));
    created(res, { user, tokens: sendTokens(req, res, tokens) });
  });

  r.post('/login', limiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { user, tokens } = await auth.login(email, password, requestContext(req));
    ok(res, { user, tokens: sendTokens(req, res, tokens) });
  });

  r.post('/refresh', async (req, res) => {
    const raw = readRefreshToken(req);
    if (!raw) throw unauthenticated('Session expired. Please sign in again.');
    const { userId, tokens } = await auth.refresh(raw, requestContext(req));
    ok(res, { user: await auth.currentUser(userId), tokens: sendTokens(req, res, tokens) });
  });

  r.post('/logout', async (req, res) => {
    await auth.logout(readRefreshToken(req));
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    ok(res, { loggedOut: true });
  });

  r.post('/forgot-password', limiter, async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    await auth.forgotPassword(email, requestContext(req));
    ok(res, { message: 'If an account exists for this address, a reset link has been sent.' });
  });

  r.post('/reset-password', limiter, async (req, res) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await auth.resetPassword(token, password, requestContext(req));
    ok(res, { message: 'Password updated. Please sign in.' });
  });

  r.post('/accept-invite', limiter, async (req, res) => {
    const { token, password, phone } = parse(acceptInviteSchema, req.body);
    const { user, tokens } = await auth.acceptInvite(token, password, phone, requestContext(req));
    ok(res, { user, tokens: sendTokens(req, res, tokens) });
  });

  r.get('/me', authenticate, async (req, res) => {
    ok(res, await auth.currentUser(requireAuth(req).userId));
  });

  r.post('/change-password', authenticate, async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const tokens = await auth.changePassword(requireAuth(req).userId, currentPassword, newPassword, requestContext(req));
    ok(res, { tokens: sendTokens(req, res, tokens) });
  });

  return r;
}
