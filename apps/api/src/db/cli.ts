/**
 * Database CLI:  migrate | rollback | seed [--demo] | reset
 *   seed       reference data (roles, permissions, service categories, default settings) — idempotent, safe in production
 *   seed --demo  also loads demo staff, customers, products and stock (refused when NODE_ENV=production)
 *   reset      drop everything and rebuild with demo data (refused when NODE_ENV=production)
 */
import { db } from './knex.js';
import { env } from '../config/env.js';
import { seedReference } from './seeds/reference.js';
import { seedDemo } from './seeds/demo.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../core/password.js';

async function main() {
  const [cmd, ...flags] = process.argv.slice(2);
  switch (cmd) {
    case 'migrate': {
      const [batch, files] = await db.migrate.latest();
      console.log(files.length ? `Batch ${batch}: ${files.join(', ')}` : 'Already up to date');
      break;
    }
    case 'rollback': {
      const [batch, files] = await db.migrate.rollback();
      console.log(files.length ? `Rolled back batch ${batch}: ${files.join(', ')}` : 'Nothing to roll back');
      break;
    }
    case 'seed': {
      await seedReference(db);
      console.log('Reference data seeded');
      if (flags.includes('--demo') || (env.NODE_ENV === 'development' && !flags.includes('--no-demo'))) {
        if (env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production');
        await seedDemo(db);
        console.log('Demo data seeded (see docs/04_SETUP.md for the demo accounts)');
      }
      break;
    }
    case 'reset': {
      if (env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
      await db.migrate.rollback(undefined, true);
      await db.migrate.latest();
      await seedReference(db);
      await seedDemo(db);
      console.log('Database rebuilt with reference and demo data');
      break;
    }
    case 'create-admin': {
      // Bootstrap the first administrator:  create-admin <email> <first-name> <last-name>
      const [email, first, last] = flags;
      if (!email || !first || !last || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Usage: create-admin <email> <first-name> <last-name>');
      if (await db('users').where({ email: email.toLowerCase() }).first('id')) throw new Error(`A user with e-mail ${email} already exists`);
      await seedReference(db);
      const password = randomBytes(12).toString('base64url');
      await db.transaction(async (trx) => {
        const [id] = await trx('users').insert({
          email: email.toLowerCase(), first_name: first, last_name: last, account_type: 'STAFF',
          password_hash: await hashPassword(password), must_change_password: true, email_verified_at: trx.fn.now(3),
        });
        const role = await trx('roles').where({ code: 'ADMIN' }).first('id');
        await trx('user_roles').insert({ user_id: id, role_id: role.id });
        await trx('audit_logs').insert({ action: 'staff.admin_bootstrapped', entity_type: 'user', entity_id: id });
      });
      console.log(`Administrator ${email} created. One-time password: ${password}\nSign in and you will be asked to change it immediately.`);
      break;
    }
    default:
      console.log('Usage: cli.ts migrate | rollback | seed [--demo|--no-demo] | reset | create-admin <email> <first> <last>');
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
