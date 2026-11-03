import type { Knex } from 'knex';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@dante/shared';
import { fk, stamps } from '../schema-helpers.js';

export async function up(knex: Knex): Promise<void> {
  /**
   * A payment against a sales order or a support request. Offline payments are recorded by staff;
   * gateway payments are created PENDING and settled only by a verified gateway callback.
   */
  await knex.schema.createTable('payments', (t) => {
    t.bigIncrements('id');
    t.string('reference', 24).notNullable().unique();
    t.enum('payable_type', ['SALES_ORDER', 'SUPPORT_REQUEST']).notNullable();
    t.bigInteger('payable_id').unsigned().notNullable();
    fk(t, 'customer_user_id', 'users');
    fk(t, 'organization_id', 'organizations', { nullable: true });
    t.enum('method', PAYMENT_METHODS as unknown as string[]).notNullable();
    t.enum('status', PAYMENT_STATUSES as unknown as string[]).notNullable().defaultTo('PENDING');
    t.string('currency', 3).notNullable();
    t.bigInteger('amount_minor').unsigned().notNullable();
    t.string('provider', 30).notNullable().defaultTo('OFFLINE');
    // gateway checkout/intent id or the offline receipt/transaction reference; unique per provider
    t.string('provider_reference', 190);
    t.string('checkout_url', 1000);
    fk(t, 'recorded_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    fk(t, 'verified_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('verified_at', { precision: 3 });
    t.dateTime('succeeded_at', { precision: 3 });
    t.dateTime('refunded_at', { precision: 3 });
    t.string('note', 500);
    stamps(t, knex);
    t.unique(['provider', 'provider_reference']);
    t.index(['payable_type', 'payable_id']);
    t.index(['status', 'created_at']);
    t.index(['customer_user_id']);
  });

  /** Append-only log of everything that happened to a payment, including raw gateway events. */
  await knex.schema.createTable('payment_transactions', (t) => {
    t.bigIncrements('id');
    fk(t, 'payment_id', 'payments', { onDelete: 'CASCADE' });
    t.string('event_type', 60).notNullable(); // CREATED | RECORDED | VERIFIED | GATEWAY_EVENT | REFUNDED | FAILED
    // gateway event id: unique so a redelivered webhook is recognised and not processed twice
    t.string('provider_event_id', 190).unique();
    t.string('status_after', 20).notNullable();
    t.bigInteger('amount_minor').unsigned();
    t.json('payload');
    fk(t, 'actor_user_id', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['payment_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('payment_transactions');
  await knex.schema.dropTableIfExists('payments');
}
