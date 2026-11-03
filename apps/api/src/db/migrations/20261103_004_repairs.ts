import type { Knex } from 'knex';
import { QUOTATION_STATUSES, QUOTATION_ITEM_TYPES, STOCK_LINE_STATES } from '@dante/shared';
import { fk, stamps } from '../schema-helpers.js';

export async function up(knex: Knex): Promise<void> {
  /** Physical handling of a device (workshop intake or on-site visit). One per hardware/on-site request. */
  await knex.schema.createTable('repair_jobs', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' }).unique();
    fk(t, 'device_id', 'devices', { nullable: true, onDelete: 'SET NULL' });
    t.enum('intake_type', ['WORKSHOP', 'ONSITE']).notNullable();
    t.dateTime('appointment_at', { precision: 3 });
    t.dateTime('received_at', { precision: 3 });
    fk(t, 'received_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.text('condition_notes');
    t.string('accessories', 1000);
    t.string('serial_number', 120);
    t.dateTime('customer_acknowledged_at', { precision: 3 });
    t.string('acknowledged_by_name', 160);
    fk(t, 'intake_consent_id', 'customer_consents', { nullable: true });
    t.dateTime('returned_at', { precision: 3 });
    t.string('returned_to', 160);
    stamps(t, knex);
  });

  await knex.schema.createTable('repair_diagnostics', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'technician_user_id', 'users');
    t.text('findings').notNullable();
    t.text('root_cause');
    t.text('recommended_action');
    t.boolean('visible_to_customer').notNullable().defaultTo(true);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id']);
  });

  await knex.schema.createTable('repair_work_logs', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'technician_user_id', 'users');
    t.text('activity').notNullable();
    t.integer('minutes_spent').unsigned().notNullable().defaultTo(0);
    t.boolean('visible_to_customer').notNullable().defaultTo(false);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['support_request_id']);
  });

  /**
   * Quotations apply to any chargeable request (a paid remote session can have a service-only quote).
   * A revision supersedes the previous one; approvals are immutable history.
   */
  await knex.schema.createTable('quotations', (t) => {
    t.bigIncrements('id');
    t.string('reference', 24).notNullable().unique();
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    t.integer('revision').unsigned().notNullable().defaultTo(1);
    fk(t, 'supersedes_id', 'quotations', { nullable: true, onDelete: 'SET NULL' });
    t.enum('status', QUOTATION_STATUSES as unknown as string[]).notNullable().defaultTo('DRAFT');
    fk(t, 'prepared_by', 'users');
    t.string('currency', 3).notNullable();
    t.bigInteger('subtotal_minor').unsigned().notNullable();
    t.integer('tax_rate_bp').unsigned().notNullable().defaultTo(0);
    t.boolean('tax_inclusive').notNullable().defaultTo(false);
    t.bigInteger('tax_minor').unsigned().notNullable().defaultTo(0);
    t.bigInteger('total_minor').unsigned().notNullable();
    t.integer('expected_duration_days').unsigned();
    t.date('valid_until').notNullable();
    t.string('notes', 2000);
    t.dateTime('sent_at', { precision: 3 });
    t.dateTime('decided_at', { precision: 3 });
    fk(t, 'decided_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.string('decision_comment', 1000);
    stamps(t, knex);
    t.unique(['support_request_id', 'revision']);
    t.index(['status']);
  });

  await knex.schema.createTable('quotation_items', (t) => {
    t.bigIncrements('id');
    fk(t, 'quotation_id', 'quotations', { onDelete: 'CASCADE' });
    t.enum('item_type', QUOTATION_ITEM_TYPES as unknown as string[]).notNullable();
    t.string('description', 300).notNullable();
    fk(t, 'product_id', 'products', { nullable: true });
    t.integer('quantity').unsigned().notNullable();
    t.bigInteger('unit_price_minor').unsigned().notNullable();
    t.bigInteger('line_total_minor').unsigned().notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['quotation_id']);
  });

  /**
   * Parts used by a repair. Created when a quotation containing PART lines is approved; reserved against
   * the shared inventory; consumed when installed; released if the approval is superseded or cancelled.
   */
  await knex.schema.createTable('repair_parts', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' });
    fk(t, 'quotation_item_id', 'quotation_items', { nullable: true, onDelete: 'SET NULL' }); // several parts may carry over to one revised line
    fk(t, 'product_id', 'products');
    t.integer('quantity').unsigned().notNullable();
    t.boolean('chargeable').notNullable().defaultTo(true);
    t.enum('stock_state', STOCK_LINE_STATES as unknown as string[]).notNullable().defaultTo('NONE');
    t.boolean('awaiting_stock').notNullable().defaultTo(false);
    t.dateTime('reserved_at', { precision: 3 });
    t.dateTime('consumed_at', { precision: 3 });
    t.dateTime('released_at', { precision: 3 });
    fk(t, 'installed_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.string('notes', 500);
    stamps(t, knex);
    t.index(['support_request_id', 'stock_state']);
  });

  await knex.schema.createTable('service_reports', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' }).unique();
    fk(t, 'technician_user_id', 'users');
    t.text('original_problem').notNullable();
    t.text('diagnosis').notNullable();
    t.text('actions_performed').notNullable();
    t.text('changes_made');
    t.json('parts_replaced').notNullable(); // snapshot of consumed parts at submission
    t.text('testing_results').notNullable();
    t.json('remote_sessions').notNullable(); // snapshot of remote session evidence
    t.text('recommendations');
    t.integer('warranty_days').unsigned().notNullable().defaultTo(0);
    t.text('warranty_terms');
    t.enum('outcome', ['RESOLVED', 'PARTIALLY_RESOLVED', 'NOT_RESOLVED', 'NOT_REPAIRABLE']).notNullable();
    t.dateTime('submitted_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
  });

  await knex.schema.createTable('repair_warranties', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' }).unique();
    fk(t, 'device_id', 'devices', { nullable: true, onDelete: 'SET NULL' });
    t.date('starts_on').notNullable();
    t.date('ends_on').notNullable();
    t.text('terms');
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
  });

  await knex.schema.createTable('customer_feedback', (t) => {
    t.bigIncrements('id');
    fk(t, 'support_request_id', 'support_requests', { onDelete: 'CASCADE' }).unique();
    fk(t, 'user_id', 'users');
    fk(t, 'technician_user_id', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.tinyint('rating').unsigned().notNullable();
    t.boolean('issue_resolved').notNullable();
    t.tinyint('timeliness_rating').unsigned();
    t.tinyint('communication_rating').unsigned();
    t.tinyint('professionalism_rating').unsigned();
    t.text('comment');
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['technician_user_id']);
  });
  await knex.raw('ALTER TABLE customer_feedback ADD CONSTRAINT feedback_rating_range CHECK (rating BETWEEN 1 AND 5)');
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'customer_feedback', 'repair_warranties', 'service_reports', 'repair_parts', 'quotation_items', 'quotations',
    'repair_work_logs', 'repair_diagnostics', 'repair_jobs',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
