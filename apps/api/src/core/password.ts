import argon2 from 'argon2';
import { isTest } from '../config/env.js';

// OWASP-recommended argon2id parameters; lighter in tests only to keep the suite fast.
const options: argon2.HashOptions & { raw?: false } = isTest
  ? { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 }
  : { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { ...options, raw: false });
}

export async function verifyPassword(hash: string | null | undefined, plain: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Used when the user does not exist, so response time does not reveal which e-mails are registered. */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password-0');
  await verifyPassword(await dummyHash, plain);
}
