import type { Knex } from 'knex';
import { REQUEST_STATUSES, REMOTE_SESSION_STATUSES } from '@dante/shared';
import { fk, stamps } from '../schema-helpers.js';

const SERVICE_TYPES = ['REMOTE_SUPPORT', 'HARDWARE_REPAIR', 'ONSITE_SUPPORT', 'CONSULTATION'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('service_categories', (t) => {
    t.bigIncrements('id');
    t.string('name', 120).notNullable().unique();
    t.string('description', 500);
    t.enum('default_service_type', SERVICE_TYPES);
    t.string('icon', 40);
    t.integer('sort_order').notNullable().defaultTo(100);
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(t, knex);
  });

  /** Technician profile: availability and specialities (role membership lives in user_roles). */
  await knex.schema.createTable('technicians', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' }).unique();
    t.string('specialties', 300);
    t.boolean('is_available').notNullable().defaultTo(true);
    t.integer('max_active_jobs').unsigned().notNullable().defaultTo(10);
    stamps(t, knex);
  });

  /** A device belongs to an individual customer OR to an organisation (shared by its employees). */
  await knex.schema.createTable('devices', (t) => {
    t.bigIncrements('id');
    fk(t, 'owner_user_id', 'users', { nullable: true, onDelete: 'SET NULL' });
    fk(t, 'organization_id', 'organizations', { nullable: true, onDelete: 'CASCADE' });
    t.enum('device_type', ['DESKTOP', 'LAPTOP', 'PRINTER', 'ROUTER', 'SWITCH', 'SERVER', 'PHONE_TABLET', 'OTHER']).notNullable();
    t.string('manufacturer', 80);
    t.string('model', 120);
    t.string('operating_system', 80);
    t.string('serial_number', 120);
    t.string('asset_tag', 80);
    t.string('department', 120);
    t.string('location', 120);
    t.string('notes', 500);
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(t, knex);
    t.index(['owner_user_id']);
    t.index(['organization_id']);
    t.index(['serial_number']);
  });

  await knex.schema.createTable('support_requests', (t) => {
    t.bigIncrements('id');
    t.string('reference', 24).notNullable().unique();
    fk(t, 'customer_user_id', 'users');
    fk(t, 'organization_id', 'organizations', { nullable: true });
    t.enum('service_type', SERVICE_TYPES).notNullable();
    fk(t, 'category_id', 'service_categories');
    fk(t, 'device_id', 'devices', { nullable: true, onDelete: 'SET NULL' });
    t.string('title', 160).notNullable();
    t.text('description').notNullable();
    t.text('error_messages');
    t.enum('urgency', ['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).notNullable().defaultTo('NORMAL');
    t.enum('preferred_contact', ['EMAIL', 'PHONE', 'WHATSAPP', 'IN_APP']).notNullable().defaultTo('EMAIL');
    t.string('contact_name', 160).notNullable();
    t.string('contact_email', 190).notNullable();
    t.string('contact_phone', 30).notNullable();
    t.string('department', 120);
    t.string('location', 160);
    t.string('site_address', 300);
    t.date('preferred_visit_date');
    t.enum('status', REQUEST_STATUSES as unknown as string[]).notNullable().defaultTo('SUBMITTED');
    fk(t, 'assigned_technician_id', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('submitted_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.dateTime('first_response_at', { precision: 3 }); // first staff action visible to the customer
    t.dateTime('accepted_at', { precision: 3 });
    t.dateTime('assigned_at', { precision: 3 });
    t.dateTime('completed_at', { precision: 3 });
    t.dateTime('closed_at', { precision: 3 });
    t.dateTime('cancelled_at', { precision: 3 });
    t.string('cancel_reason', 1000);
    stamps(t, knex);
    t.index(['customer_user_id', 'status']);
    t.index(['organization_id', 'status']);
    t.index(['assigned_technician_id', 'status']);
    t.index(['status', 'submitted_at']);
    t.index(['category_id']);
  });

  await knex.schema.createTable('technician_assignments', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'technician_user_id', 'users');
    fk(t, 'assigned_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.string('note', 500);
    t.dateTime('assigned_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.dateTime('unassigned_at', { precision: 3 });
    t.boolean('is_current').notNullable().defaultTo(true);
    t.index(['support_request_id', 'is_current']);
    t.index(['technician_user_id', 'is_current']);
  });

  await knex.schema.createTable('request_status_history', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    t.string('from_status', 40);
    t.string('to_status', 40).notNullable();
    fk(t, 'changed_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.string('note', 2000);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id', 'created_at']);
  });

  /** Timeline: every notable event; customers only see rows with visible_to_customer = true. */
  await knex.schema.createTable('request_activities', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    t.string('activity_type', 40).notNullable();
    t.string('message', 2000).notNullable();
    t.boolean('visible_to_customer').notNullable().defaultTo(true);
    fk(t, 'actor_user_id', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.json('metadata');
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id', 'created_at']);
  });

  await knex.schema.createTable('service_messages', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'sender_user_id', 'users');
    t.boolean('from_staff').notNullable();
    t.text('body').notNullable();
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id', 'created_at']);
  });

  /** Private technician/staff notes. Never returned by customer-facing endpoints. */
  await knex.schema.createTable('internal_notes', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'author_user_id', 'users');
    t.text('body').notNullable();
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id', 'created_at']);
  });

  /** Uploaded files live in private storage; access is checked against the owning request. */
  await knex.schema.createTable('attachments', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { nullable: true, onDelete: 'CASCADE' });
    t.string('context', 30).notNullable(); // REQUEST | MESSAGE | INTAKE_PHOTO | REPORT | INTERNAL
    t.bigInteger('context_id').unsigned();
    t.boolean('visible_to_customer').notNullable().defaultTo(true);
    fk(t, 'uploaded_by', 'users');
    t.string('original_name', 255).notNullable();
    t.string('mime_type', 100).notNullable();
    t.integer('size_bytes').unsigned().notNullable();
    t.string('storage_key', 120).notNullable().unique();
    t.string('sha256', 64).notNullable();
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id', 'context']);
  });

  await knex.schema.createTable('customer_consents', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users');
    t.enum('consent_type', ['REMOTE_ACCESS', 'REPAIR_INTAKE', 'TERMS_OF_SERVICE', 'PRIVACY_NOTICE']).notNullable();
    t.string('subject_type', 40); // e.g. REMOTE_SESSION, REPAIR_JOB
    t.bigInteger('subject_id').unsigned();
    t.string('consent_version', 40).notNullable();
    t.text('consent_text').notNullable(); // snapshot of exactly what the customer agreed to
    t.dateTime('granted_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.dateTime('revoked_at', { precision: 3 });
    t.string('revoke_reason', 500);
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.index(['user_id', 'consent_type']);
    t.index(['subject_type', 'subject_id']);
  });

  await knex.schema.createTable('remote_sessions', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'technician_user_id', 'users');
    fk(t, 'requested_by', 'users');
    t.enum('status', REMOTE_SESSION_STATUSES as unknown as string[]).notNullable().defaultTo('REQUESTED');
    t.string('instructions', 2000);
    t.string('anydesk_address', 80); // customer's AnyDesk ID or alias (never a password)
    fk(t, 'consent_id', 'customer_consents', { nullable: true });
    t.dateTime('requested_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.dateTime('authorized_at', { precision: 3 });
    t.dateTime('initiated_at', { precision: 3 });
    fk(t, 'initiated_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('active_at', { precision: 3 });
    t.dateTime('completed_at', { precision: 3 });
    t.dateTime('revoked_at', { precision: 3 });
    t.string('revoke_reason', 500);
    t.enum('outcome', ['RESOLVED', 'PARTIALLY_RESOLVED', 'NOT_RESOLVED', 'FOLLOW_UP_REQUIRED']);
    t.text('work_performed');
    // Evidence of the actual AnyDesk session: from the REST API when licensed, otherwise entered manually
    t.enum('session_data_source', ['NONE', 'MANUAL', 'ANYDESK_API']).notNullable().defaultTo('NONE');
    t.string('anydesk_session_id', 80);
    t.dateTime('session_started_at', { precision: 3 });
    t.dateTime('session_ended_at', { precision: 3 });
    t.integer('session_duration_seconds').unsigned();
    t.dateTime('api_synced_at', { precision: 3 });
    stamps(t, knex);
    t.index(['support_request_id', 'status']);
    t.index(['technician_user_id', 'status']);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' });
    t.string('type', 60).notNullable();
    t.string('title', 200).notNullable();
    t.string('body', 2000).notNullable();
    t.string('link', 300);
    t.dateTime('read_at', { precision: 3 });
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['user_id', 'read_at']);
  });

  /** One row per external channel attempt (email/SMS/WhatsApp). In-app delivery is the notification row itself. */
  await knex.schema.createTable('notification_deliveries', (t) => {
    t.bigIncrements('id');
    fk(t, 'notification_id', 'notifications', { onDelete: 'CASCADE' });
    t.enum('channel', ['EMAIL', 'SMS', 'WHATSAPP']).notNullable();
    t.string('recipient', 190).notNullable();
    t.enum('status', ['PENDING', 'SENT', 'FAILED', 'SKIPPED']).notNullable().defaultTo('PENDING');
    t.string('provider', 40);
    t.string('provider_message_id', 190);
    t.integer('attempts').unsigned().notNullable().defaultTo(0);
    t.string('last_error', 1000);
    t.dateTime('sent_at', { precision: 3 });
    stamps(t, knex);
    t.index(['status', 'updated_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'notification_deliveries', 'notifications', 'remote_sessions', 'customer_consents', 'attachments', 'internal_notes',
    'service_messages', 'request_activities', 'request_status_history', 'technician_assignments', 'support_requests',
    'devices', 'technicians', 'service_categories',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
