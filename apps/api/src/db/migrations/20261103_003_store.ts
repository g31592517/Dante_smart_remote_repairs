import type { Knex } from 'knex';
import { ORDER_STATUSES, STOCK_MOVEMENT_TYPES, STOCK_LINE_STATES, PURCHASE_ORDER_STATUSES, PAYMENT_METHODS } from '@dante/shared';
import { fk, stamps } from '../schema-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('product_categories', (t) => {
    t.bigIncrements('id');
    t.string('name', 120).notNullable();
    t.string('slug', 80).notNullable().unique();
    fk(t, 'parent_id', 'product_categories', { nullable: true, onDelete: 'SET NULL' });
    t.string('description', 500);
    t.integer('sort_order').notNullable().defaultTo(100);
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(t, knex);
  });

  await knex.schema.createTable('products', (t) => {
    t.bigIncrements('id');
    t.string('sku', 60).notNullable().unique();
    t.string('name', 200).notNullable();
    t.string('slug', 220).notNullable().unique();
    fk(t, 'category_id', 'product_categories');
    t.text('description').notNullable();
    t.bigInteger('price_minor').unsigned().notNullable();
    t.enum('condition', ['NEW', 'REFURBISHED', 'USED']).notNullable().defaultTo('NEW');
    t.string('brand', 80);
    t.integer('warranty_months').unsigned().notNullable().defaultTo(0);
    t.string('warranty_info', 1000);
    t.text('compatibility');
    t.json('specifications').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.boolean('is_spare_part').notNullable().defaultTo(false);
    stamps(t, knex);
    t.index(['category_id', 'is_active']);
    t.index(['is_featured', 'is_active']);
  });
  await knex.raw('ALTER TABLE products ADD FULLTEXT INDEX products_search_ft (name, description)');

  /** Product images are public (catalogue), stored under STORAGE_DIR/public/products. */
  await knex.schema.createTable('product_images', (t) => {
    t.bigIncrements('id');
    fk(t, 'product_id', 'products', { onDelete: 'CASCADE' });
    t.string('storage_key', 120).notNullable().unique();
    t.string('alt_text', 200);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['product_id', 'sort_order']);
  });

  /**
   * One stock row per product, shared by the shop AND the repair workshop.
   *   available = quantity_on_hand - quantity_reserved
   * Every change goes through inventoryService under SELECT ... FOR UPDATE and writes a movement.
   */
  await knex.schema.createTable('inventory', (t) => {
    fk(t, 'product_id', 'products', { onDelete: 'CASCADE' }).primary();
    t.integer('quantity_on_hand').notNullable().defaultTo(0);
    t.integer('quantity_reserved').notNullable().defaultTo(0);
    t.integer('reorder_level').notNullable().defaultTo(2);
    t.string('bin_location', 60);
    t.dateTime('updated_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'));
  });
  await knex.raw(
    'ALTER TABLE inventory ADD CONSTRAINT inventory_non_negative CHECK (quantity_on_hand >= 0 AND quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand)',
  );

  await knex.schema.createTable('inventory_movements', (t) => {
    t.bigIncrements('id');
    fk(t, 'product_id', 'products');
    t.enum('movement_type', STOCK_MOVEMENT_TYPES as unknown as string[]).notNullable();
    t.integer('on_hand_delta').notNullable().defaultTo(0);
    t.integer('reserved_delta').notNullable().defaultTo(0);
    t.integer('on_hand_after').notNullable();
    t.integer('reserved_after').notNullable();
    t.string('reference_type', 40); // SALES_ORDER_ITEM | REPAIR_PART | PURCHASE_ORDER_ITEM | ADJUSTMENT
    t.bigInteger('reference_id').unsigned();
    t.string('reason', 300);
    fk(t, 'performed_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['product_id', 'created_at']);
    t.index(['reference_type', 'reference_id']);
    t.index(['movement_type', 'created_at']);
  });

  await knex.schema.createTable('suppliers', (t) => {
    t.bigIncrements('id');
    t.string('name', 160).notNullable().unique();
    t.string('contact_name', 160);
    t.string('email', 190);
    t.string('phone', 30);
    t.string('address', 300);
    t.string('notes', 1000);
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(t, knex);
  });

  await knex.schema.createTable('purchase_orders', (t) => {
    t.bigIncrements('id');
    t.string('reference', 24).notNullable().unique();
    fk(t, 'supplier_id', 'suppliers');
    t.enum('status', PURCHASE_ORDER_STATUSES as unknown as string[]).notNullable().defaultTo('DRAFT');
    t.date('expected_at');
    t.string('notes', 1000);
    t.bigInteger('total_cost_minor').unsigned().notNullable().defaultTo(0);
    fk(t, 'created_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.dateTime('ordered_at', { precision: 3 });
    t.dateTime('received_at', { precision: 3 });
    stamps(t, knex);
    t.index(['status']);
  });

  await knex.schema.createTable('purchase_order_items', (t) => {
    t.bigIncrements('id');
    fk(t, 'purchase_order_id', 'purchase_orders', { onDelete: 'CASCADE' });
    fk(t, 'product_id', 'products');
    t.integer('quantity_ordered').unsigned().notNullable();
    t.integer('quantity_received').unsigned().notNullable().defaultTo(0);
    t.bigInteger('unit_cost_minor').unsigned().notNullable();
  });

  await knex.schema.createTable('shopping_carts', (t) => {
    t.bigIncrements('id');
    fk(t, 'user_id', 'users', { onDelete: 'CASCADE' }).unique();
    stamps(t, knex);
  });

  await knex.schema.createTable('cart_items', (t) => {
    t.bigIncrements('id');
    fk(t, 'cart_id', 'shopping_carts', { onDelete: 'CASCADE' });
    fk(t, 'product_id', 'products', { onDelete: 'CASCADE' });
    t.integer('quantity').unsigned().notNullable();
    stamps(t, knex);
    t.unique(['cart_id', 'product_id']);
  });

  await knex.schema.createTable('sales_orders', (t) => {
    t.bigIncrements('id');
    t.string('reference', 24).notNullable().unique();
    fk(t, 'customer_user_id', 'users');
    fk(t, 'organization_id', 'organizations', { nullable: true });
    t.enum('status', ORDER_STATUSES as unknown as string[]).notNullable().defaultTo('PENDING_PAYMENT');
    t.enum('fulfilment_method', ['COLLECTION', 'DELIVERY']).notNullable();
    t.enum('payment_method', PAYMENT_METHODS as unknown as string[]).notNullable();
    t.json('delivery_address'); // snapshot at checkout time
    t.string('currency', 3).notNullable();
    t.bigInteger('subtotal_minor').unsigned().notNullable();
    t.bigInteger('delivery_fee_minor').unsigned().notNullable().defaultTo(0);
    t.bigInteger('tax_minor').unsigned().notNullable().defaultTo(0);
    t.integer('tax_rate_bp').unsigned().notNullable().defaultTo(0);
    t.boolean('tax_inclusive').notNullable().defaultTo(false);
    t.bigInteger('total_minor').unsigned().notNullable();
    t.string('customer_note', 1000);
    t.dateTime('placed_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.dateTime('paid_at', { precision: 3 });
    t.dateTime('fulfilled_at', { precision: 3 });
    t.dateTime('cancelled_at', { precision: 3 });
    t.string('cancel_reason', 500);
    stamps(t, knex);
    t.index(['customer_user_id', 'placed_at']);
    t.index(['status', 'placed_at']);
  });

  await knex.schema.createTable('sales_order_items', (t) => {
    t.bigIncrements('id');
    fk(t, 'sales_order_id', 'sales_orders', { onDelete: 'CASCADE' });
    fk(t, 'product_id', 'products');
    t.string('product_name', 200).notNullable(); // snapshot
    t.string('sku', 60).notNullable(); // snapshot
    t.integer('quantity').unsigned().notNullable();
    t.bigInteger('unit_price_minor').unsigned().notNullable();
    t.bigInteger('line_total_minor').unsigned().notNullable();
    t.enum('stock_state', STOCK_LINE_STATES as unknown as string[]).notNullable().defaultTo('NONE');
    t.index(['sales_order_id']);
  });

  await knex.schema.createTable('order_status_history', (t) => {
    t.bigIncrements('id');
    fk(t, 'sales_order_id', 'sales_orders', { onDelete: 'CASCADE' });
    t.string('from_status', 30);
    t.string('to_status', 30).notNullable();
    fk(t, 'changed_by', 'users', { nullable: true, onDelete: 'SET NULL' });
    t.string('note', 1000);
    t.dateTime('created_at', { precision: 3 }).notNullable().defaultTo(knex.fn.now(3));
    t.index(['sales_order_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'order_status_history', 'sales_order_items', 'sales_orders', 'cart_items', 'shopping_carts', 'purchase_order_items',
    'purchase_orders', 'suppliers', 'inventory_movements', 'inventory', 'product_images', 'products', 'product_categories',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
