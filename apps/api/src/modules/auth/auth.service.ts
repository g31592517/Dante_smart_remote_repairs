import type { AuthUser, RegisterInput } from '@dante/shared';
import { db, type Db } from '../../db/knex.js';
import { env } from '../../config/env.js';
import { audit } from '../../core/audit.js';
import { AppError, badRequest, conflict, unauthenticated } from '../../core/errors.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../core/password.js';
import { newFamilyId, newOpaqueToken, sha256, signAccessToken } from '../../core/tokens.js';
import { loadAuthContext, type AuthContext } from '../../core/auth.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export function toAuthUser(ctx: AuthContext, mustChangePassword = false, phone: string | null = null): AuthUser {
  return {
    id: ctx.userId,
    email: ctx.email,
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    phone,
    accountType: ctx.accountType,
    roles: ctx.roles,
    permissions: [...ctx.permissions],
    organization: ctx.org ? { id: ctx.org.id, name: ctx.org.name, orgRole: ctx.org.role } : null,
    mustChangePassword,
  };
}

export async function currentUser(userId: number): Promise<AuthUser> {
  const ctx = await loadAuthContext(userId);
  if (!ctx) throw unauthenticated();
  const row = await db('users').where({ id: userId }).first('must_change_password', 'phone');
  return toAuthUser(ctx, !!row?.must_change_password, row?.phone ?? null);
}

async function issueTokens(userId: number, client: ClientInfo, familyId = newFamilyId(), conn: Db = db) {
  const accessToken = await signAccessToken(userId);
  const refresh = newOpaqueToken();
  await conn('refresh_tokens').insert({
    user_id: userId,
    token_hash: refresh.hash,
    family_id: familyId,
    expires_at: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    user_agent: client.userAgent?.slice(0, 255) ?? null,
    ip: client.ip ?? null,
  });
  return { accessToken, accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS, refreshToken: refresh.raw };
}

export async function register(input: RegisterInput, client: ClientInfo) {
  const existing = await db('users').where({ email: input.email }).first('id');
  if (existing) throw conflict('An account with this e-mail address already exists');
  const settings = await getSettings();
  const passwordHash = await hashPassword(input.password);

  const userId = await db.transaction(async (trx) => {
    const [insertedId] = await trx('users').insert({
      email: input.email,
      password_hash: passwordHash,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: input.phone,
      account_type: input.accountType,
      terms_accepted_at: trx.fn.now(3),
      terms_version: settings.termsVersion,
    });
    const id = insertedId as number;
    const role = await trx('roles').where({ code: 'CUSTOMER' }).first('id');
    await trx('user_roles').insert({ user_id: id, role_id: role.id });
    await trx('customer_consents').insert({
      user_id: id,
      consent_type: 'TERMS_OF_SERVICE',
      consent_version: settings.termsVersion,
      consent_text: settings.termsOfServiceText,
      ip: client.ip ?? null,
      user_agent: client.userAgent?.slice(0, 255) ?? null,
    });
    if (input.accountType === 'CORPORATE') {
      const [orgId] = await trx('organizations').insert({
        name: input.organizationName,
        registration_no: input.organizationRegistrationNo ?? null,
        billing_email: input.email,
        phone: input.phone,
        created_by: id,
      });
      await trx('organization_members').insert({
        organization_id: orgId,
        user_id: id,
        org_role: 'ORG_ADMIN',
        department: input.department ?? null,
      });
    }
    await audit({ actorUserId: id, action: 'auth.registered', entityType: 'user', entityId: id, ...client }, trx);
    await notify(
      {
        userIds: [id],
        type: 'WELCOME',
        title: `Welcome to ${settings.businessName}`,
        body: 'Your account is ready. You can now request ICT support, track repairs and shop for IT products.',
        link: '/account',
      },
      trx,
    );
    return id as number;
  });
  const tokens = await issueTokens(userId, client);
  return { user: await currentUser(userId), tokens };
}

export async function login(email: string, password: string, client: ClientInfo) {
  const user = await db('users').where({ email }).first('id', 'password_hash', 'is_active', 'failed_login_count', 'locked_until');
  if (!user) {
    await burnPasswordCheck(password);
    throw unauthenticated('Incorrect e-mail address or password');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Try again in a few minutes or reset your password.');
  }
  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    const failed = user.failed_login_count + 1;
    await db('users')
      .where({ id: user.id })
      .update({
        failed_login_count: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        locked_until: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      });
    await audit({ actorUserId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, ...client });
    throw unauthenticated('Incorrect e-mail address or password');
  }
  if (!user.is_active) throw unauthenticated('This account has been deactivated. Please contact support.');
  await db('users').where({ id: user.id }).update({ failed_login_count: 0, locked_until: null, last_login_at: db.fn.now(3) });
  await audit({ actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ...client });
  const tokens = await issueTokens(user.id, client);
  return { user: await currentUser(user.id), tokens };
}

/**
 * Rotating refresh tokens. Presenting an already-used or revoked token revokes the whole family
 * (it indicates the token was stolen and replayed).
 */
export async function refresh(rawToken: string, client: ClientInfo) {
  const hash = sha256(rawToken);
  const outcome = await db.transaction(async (trx) => {
    const row = await trx('refresh_tokens').where({ token_hash: hash }).forUpdate().first();
    if (!row) return { kind: 'invalid' as const };
    if (row.used_at || row.revoked_at) {
      // Reuse of a rotated token: revoke the entire family. This must COMMIT, so it is not thrown here.
      await trx('refresh_tokens').where({ family_id: row.family_id }).whereNull('revoked_at').update({ revoked_at: trx.fn.now(3) });
      await audit({ actorUserId: row.user_id, action: 'auth.refresh_reuse_detected', entityType: 'user', entityId: row.user_id, ...client }, trx);
      return { kind: 'invalid' as const };
    }
    if (new Date(row.expires_at) < new Date()) return { kind: 'invalid' as const };
    const active = await trx('users').where({ id: row.user_id, is_active: true }).first('id');
    if (!active) return { kind: 'inactive' as const };
    await trx('refresh_tokens').where({ id: row.id }).update({ used_at: trx.fn.now(3) });
    const tokens = await issueTokens(row.user_id, client, row.family_id, trx);
    return { kind: 'ok' as const, userId: row.user_id as number, tokens };
  });
  if (outcome.kind === 'inactive') throw unauthenticated('This account is not active');
  if (outcome.kind !== 'ok') throw unauthenticated('Session expired. Please sign in again.');
  return { userId: outcome.userId, tokens: outcome.tokens };
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  const row = await db('refresh_tokens').where({ token_hash: sha256(rawToken) }).first('family_id');
  if (row) await db('refresh_tokens').where({ family_id: row.family_id }).whereNull('revoked_at').update({ revoked_at: db.fn.now(3) });
}

async function revokeAllSessions(userId: number, conn: Db = db) {
  await conn('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: conn.fn.now(3) });
}

/* ---------------- one-time tokens: invitations and password resets ---------------- */

export async function createUserToken(userId: number, purpose: 'INVITE' | 'PASSWORD_RESET', hours: number, conn: Db = db) {
  const t = newOpaqueToken();
  await conn('user_tokens').where({ user_id: userId, purpose }).whereNull('used_at').update({ used_at: conn.fn.now(3) });
  await conn('user_tokens').insert({ user_id: userId, purpose, token_hash: t.hash, expires_at: new Date(Date.now() + hours * 3_600_000) });
  return t.raw;
}

async function consumeUserToken(raw: string, purpose: 'INVITE' | 'PASSWORD_RESET', conn: Db) {
  const row = await conn('user_tokens').where({ token_hash: sha256(raw), purpose }).forUpdate().first();
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) throw badRequest('This link is invalid or has expired');
  await conn('user_tokens').where({ id: row.id }).update({ used_at: conn.fn.now(3) });
  return row.user_id as number;
}

export async function forgotPassword(email: string, client: ClientInfo) {
  const user = await db('users').where({ email, is_active: true }).first('id', 'first_name');
  // Always succeed: the response must not reveal whether the address is registered.
  if (!user) return;
  await db.transaction(async (trx) => {
    const raw = await createUserToken(user.id, 'PASSWORD_RESET', 1, trx);
    await audit({ actorUserId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, ...client }, trx);
    await notify(
      {
        userIds: [user.id],
        type: 'PASSWORD_RESET',
        title: 'Reset your password',
        body: `Hello ${user.first_name}, use the link below within one hour to choose a new password. If you did not ask for this, ignore this message.`,
        link: `/reset-password?token=${encodeURIComponent(raw)}`,
      },
      trx,
    );
  });
}

export async function resetPassword(token: string, password: string, client: ClientInfo) {
  const hash = await hashPassword(password);
  await db.transaction(async (trx) => {
    const userId = await consumeUserToken(token, 'PASSWORD_RESET', trx);
    await trx('users').where({ id: userId }).update({ password_hash: hash, must_change_password: false, failed_login_count: 0, locked_until: null });
    await revokeAllSessions(userId, trx);
    await audit({ actorUserId: userId, action: 'auth.password_reset', entityType: 'user', entityId: userId, ...client }, trx);
  });
}

export async function acceptInvite(token: string, password: string, phone: string | undefined, client: ClientInfo) {
  const hash = await hashPassword(password);
  const userId = await db.transaction(async (trx) => {
    const id = await consumeUserToken(token, 'INVITE', trx);
    const settings = await getSettings(trx);
    await trx('users').where({ id }).update({
      password_hash: hash,
      email_verified_at: trx.fn.now(3),
      must_change_password: false,
      ...(phone ? { phone } : {}),
      terms_accepted_at: trx.fn.now(3),
      terms_version: settings.termsVersion,
    });
    await audit({ actorUserId: id, action: 'auth.invite_accepted', entityType: 'user', entityId: id, ...client }, trx);
    return id;
  });
  const tokens = await issueTokens(userId, client);
  return { user: await currentUser(userId), tokens };
}

export async function changePassword(userId: number, current: string, next: string, client: ClientInfo) {
  const user = await db('users').where({ id: userId }).first('password_hash');
  if (!(await verifyPassword(user?.password_hash, current))) throw badRequest('Your current password is incorrect');
  const hash = await hashPassword(next);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: userId }).update({ password_hash: hash, must_change_password: false });
    await revokeAllSessions(userId, trx);
    await audit({ actorUserId: userId, action: 'auth.password_changed', entityType: 'user', entityId: userId, ...client }, trx);
  });
  return issueTokens(userId, client);
}
