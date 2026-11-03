import type { Knex } from 'knex';
import { fk, stamps } from '../schema-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('roles', (t) => {
    t.bigIncrements('id');
    t.string('code', 40).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('description', 255);
    t.boolean('is_staff').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.bigIncrements('id');
    t.string('code', 60).notNullable().unique();
    t.string('description', 255);
  });

  await knex.schema.createTable('role_permissions', (t) => {
    fk(t, 'role_id', 'roles', { onDelete: 'CASCADE' });
    fk(t, 'permission_id', 'permissions', { onDelete: 'CASCADE' });
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('users', (t) => {
    t.bigIncrements('id');
    t.string('email', 190).notNullable().unique();
    t.string('password_hash', 255).nullable(); // null until an invited user sets a password
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable();
    t.string('phone', 30);
    t.enum('account_type', ['INDIVIDUAL', 'CORPORATE', 'STAFF']).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.dateTime('email_verified_at', { precision: 3 });
    t.dateTime('last_login_at', { precision: 3 });
    t.integer('failed_login_count').unsigned().notNullable().defaultTo(0);
    t.dateTime('locked_until', { precision: 3 });
    t.dateTime('terms_accepted_at', { precision: 3 });
    t.string('terms_version', 40);
    stamps(t, knex);
    t.index(['account_type', 'is_active']);
  });

  await knex.schema.createTable('user_roles', (t) => {
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' });
    fk(t, 'role_id', 'roles', { onDelete: 'RESTRICT' });
    t.dateTime('granted_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    fk(t, 'granted_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.primary(['user_id', 'role_id']);
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' });
    t.string('token_hash', 64).notNullable().unique(); // sha256 hex; the raw token is never stored
    t.string('family_id', 36).notNullable(); // rotation family, for reuse detection
    t.dateTime('expires_at', { precision: 3 }).notNullable();
    t.dateTime('revoked_at', { precision: 3 });
    t.dateTime('used_at', { precision: 3 });
    t.string('user_agent', 255);
    t.string('ip', 64);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['user_id', 'revoked_at']);
    t.index(['family_id']);
  });

  await knex.schema.createTable('user_tokens', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' });
    t.enum('purpose', ['INVITE', 'PASSWORD_RESET', 'EMAIL_VERIFY']).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.dateTime('expires_at', { precision: 3 }).notNullable();
    t.dateTime('used_at', { precision: 3 });
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['user_id', 'purpose']);
  });

  await knex.schema.createTable('organizations', (t) => {
    t.bigIncrements('id');
    t.string('name', 160).notNullable();
    t.string('registration_no', 80);
    t.string('billing_email', 190);
    t.string('phone', 30);
    t.string('address', 300);
    t.boolean('central_billing').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    fk(t, 'created_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    stamps(t, knex);
    t.index(['name']);
  });

  await knex.schema.createTable('organization_members', (t) => {
    t.bigIncrements('id');
    fk(t, 'organization_id', 'organizations', { onDelete: 'CASCADE' });
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' });
    t.enum('org_role', ['ORG_ADMIN', 'ORG_MEMBER']).notNullable().defaultTo('ORG_MEMBER');
    t.string('department', 120);
    t.string('location', 120);
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(t, knex);
    // a customer user belongs to at most one organisation
    t.unique(['user_id']);
    t.index(['organization_id', 'is_active']);
  });

  await knex.schema.createTable('customer_addresses', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' });
    t.string('label', 60).notNullable();
    t.string('line1', 160).notNullable();
    t.string('line2', 160);
    t.string('city', 80).notNullable();
    t.string('region', 80);
    t.string('postal_code', 20);
    t.string('country', 80).notNullable();
    t.string('phone', 30);
    t.boolean('is_default').notNullable().defaultTo(false);
    stamps(t, knex);
  });

  await knex.schema.createTable('system_settings', (t) => {
    t.string('key', 80).primary();
    t.json('value').notNullable();
    fk(t, 'updated_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'));
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    fk(t, 'actor_user_id', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.string('action', 80).notNullable();
    t.string('entity_type', 60);
    t.bigInteger('entity_id').unsigned();
    t.json('metadata');
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['entity_type', 'entity_id']);
    t.index(['actor_user_id', 'created_at']);
    t.index(['action', 'created_at']);
  });

  /** Year-scoped counters for human-readable references (SR-2026-000123). */
  await knex.schema.createTable('reference_sequences', (t) => {
    t.string('name', 20).notNullable();
    t.integer('year').notNullable();
    t.integer('value').unsigned().notNullable().defaultTo(0);
    t.primary(['name', 'year']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'reference_sequences', 'audit_logs', 'system_settings', 'customer_addresses', 'organization_members', 'organizations',
    'user_tokens', 'refresh_tokens', 'user_roles', 'users', 'role_permissions', 'permissions', 'roles',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
