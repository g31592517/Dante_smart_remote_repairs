import type { Knex } from 'knex';
import { hashPassword } from '../../core/password.js';

/** Development/demo data. Every account uses DEMO_PASSWORD. Never loaded in production. */
export const DEMO_PASSWORD = 'DemoPass123!';

export const DEMO_USERS = [
  { email: 'admin@dante.local', first: 'Ada', last: 'Admin', type: 'STAFF', roles: ['ADMIN'] },
  { email: 'manager@dante.local', first: 'Mike', last: 'Manager', type: 'STAFF', roles: ['SUPPORT_MANAGER'] },
  { email: 'tech1@dante.local', first: 'Tom', last: 'Technician', type: 'STAFF', roles: ['TECHNICIAN'], specialties: 'Windows, email, networking' },
  { email: 'tech2@dante.local', first: 'Tina', last: 'Hardware', type: 'STAFF', roles: ['TECHNICIAN'], specialties: 'Laptop and printer hardware' },
  { email: 'store@dante.local', first: 'Sam', last: 'Store', type: 'STAFF', roles: ['INVENTORY_MANAGER'] },
  { email: 'finance@dante.local', first: 'Fiona', last: 'Finance', type: 'STAFF', roles: ['FINANCE_OFFICER'] },
  { email: 'jane@example.com', first: 'Jane', last: 'Customer', type: 'INDIVIDUAL', roles: ['CUSTOMER'] },
  { email: 'it.lead@acme.example', first: 'Alex', last: 'Acme', type: 'CORPORATE', roles: ['CUSTOMER'], org: 'ORG_ADMIN' },
  { email: 'staff@acme.example', first: 'Bea', last: 'Acme', type: 'CORPORATE', roles: ['CUSTOMER'], org: 'ORG_MEMBER' },
] as const;

const CATEGORIES = [
  { slug: 'components', name: 'Computer components' },
  { slug: 'memory', name: 'Memory (RAM)', parent: 'components' },
  { slug: 'storage', name: 'Storage (SSD & HDD)', parent: 'components' },
  { slug: 'power', name: 'Chargers & power adapters' },
  { slug: 'peripherals', name: 'Keyboards, mice & peripherals' },
  { slug: 'monitors', name: 'Monitors' },
  { slug: 'networking', name: 'Networking equipment' },
  { slug: 'printers', name: 'Printers & accessories' },
  { slug: 'cables', name: 'Cables & connectors' },
];

// prices in minor units of the configured currency
const PRODUCTS = [
  { sku: 'SSD-512-NVME', name: '512GB NVMe M.2 SSD', cat: 'storage', price: 5900, stock: 12, spare: true, featured: true, brand: 'Kingston',
    specs: { Capacity: '512 GB', Interface: 'PCIe 3.0 x4 NVMe', 'Form factor': 'M.2 2280' }, compat: 'Laptops and desktops with an M.2 2280 NVMe slot' },
  { sku: 'SSD-1TB-SATA', name: '1TB 2.5" SATA SSD', cat: 'storage', price: 7900, stock: 6, spare: true, brand: 'Crucial',
    specs: { Capacity: '1 TB', Interface: 'SATA III 6 Gb/s', 'Form factor': '2.5 inch' }, compat: 'Any device with a 2.5" SATA bay' },
  { sku: 'HDD-1TB-25', name: '1TB 2.5" laptop hard drive', cat: 'storage', price: 4500, stock: 3, spare: true, brand: 'Seagate',
    specs: { Capacity: '1 TB', Speed: '5400 rpm' }, compat: 'Laptops with a 2.5" SATA bay' },
  { sku: 'RAM-8-DDR4-SO', name: '8GB DDR4 3200 SODIMM', cat: 'memory', price: 2800, stock: 20, spare: true, featured: true, brand: 'Crucial',
    specs: { Capacity: '8 GB', Type: 'DDR4-3200', 'Form factor': 'SODIMM (laptop)' }, compat: 'Laptops with DDR4 SODIMM slots' },
  { sku: 'RAM-16-DDR4-DT', name: '16GB DDR4 3200 desktop DIMM', cat: 'memory', price: 4900, stock: 8, spare: true, brand: 'Kingston',
    specs: { Capacity: '16 GB', Type: 'DDR4-3200', 'Form factor': 'DIMM (desktop)' }, compat: 'Desktops with DDR4 DIMM slots' },
  { sku: 'CHG-65W-USBC', name: '65W USB-C laptop charger', cat: 'power', price: 3500, stock: 10, spare: true, featured: true, brand: 'Generic',
    specs: { Output: '65 W', Connector: 'USB-C PD' }, compat: 'USB-C Power Delivery laptops up to 65 W' },
  { sku: 'KB-MS-COMBO', name: 'Wireless keyboard & mouse set', cat: 'peripherals', price: 2900, stock: 15, brand: 'Logitech',
    specs: { Connection: '2.4 GHz USB receiver', Layout: 'US' } },
  { sku: 'MON-24-IPS', name: '24" Full HD IPS monitor', cat: 'monitors', price: 15900, stock: 4, featured: true, brand: 'Dell',
    specs: { Size: '24 inch', Resolution: '1920×1080', Panel: 'IPS', Inputs: 'HDMI, DisplayPort' } },
  { sku: 'RTR-AX1800', name: 'Wi-Fi 6 AX1800 router', cat: 'networking', price: 8900, stock: 5, brand: 'TP-Link',
    specs: { Standard: 'Wi-Fi 6 (802.11ax)', Ports: '4× Gigabit LAN' } },
  { sku: 'SW-8P-GIGA', name: '8-port Gigabit switch', cat: 'networking', price: 3200, stock: 1, brand: 'Netgear',
    specs: { Ports: '8× Gigabit', Management: 'Unmanaged' } },
  { sku: 'TON-HP-85A', name: 'HP 85A compatible toner', cat: 'printers', price: 2200, stock: 9, spare: true, condition: 'NEW', brand: 'Compatible',
    specs: { Yield: '1,600 pages' }, compat: 'HP LaserJet P1102, M1132, M1212' },
  { sku: 'CBL-HDMI-2M', name: 'HDMI cable 2 m', cat: 'cables', price: 600, stock: 40, brand: 'Generic', specs: { Length: '2 m', Version: 'HDMI 2.0' } },
  { sku: 'LAP-REF-T480', name: 'Refurbished ThinkPad T480', cat: 'components', price: 32900, stock: 2, condition: 'REFURBISHED', brand: 'Lenovo',
    specs: { CPU: 'Intel Core i5-8350U', RAM: '8 GB', Storage: '256 GB SSD', Display: '14" FHD' }, warranty: 6 },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function seedDemo(knex: Knex): Promise<void> {
  const exists = await knex('users').where({ email: 'admin@dante.local' }).first();
  if (exists) return;
  const hash = await hashPassword(DEMO_PASSWORD);

  await knex.transaction(async (trx) => {
    const roleIds = new Map((await trx('roles').select('id', 'code')).map((r) => [r.code as string, r.id as number]));
    const [orgId] = await trx('organizations').insert({
      name: 'Acme Logistics Ltd', registration_no: 'ACME-001', billing_email: 'accounts@acme.example', phone: '+000 111 222',
      address: '12 Industrial Road', central_billing: true,
    });
    const userIds: Record<string, number> = {};
    for (const u of DEMO_USERS) {
      const [id] = await trx('users').insert({
        email: u.email, password_hash: hash, first_name: u.first, last_name: u.last, phone: '+000 700 000 000',
        account_type: u.type, email_verified_at: trx.fn.now(3), terms_accepted_at: trx.fn.now(3), terms_version: 'terms-v1',
      });
      userIds[u.email] = id as number;
      for (const r of u.roles) await trx('user_roles').insert({ user_id: id, role_id: roleIds.get(r) });
      if ('specialties' in u) await trx('technicians').insert({ user_id: id, specialties: u.specialties });
      if ('org' in u) {
        await trx('organization_members').insert({
          organization_id: orgId, user_id: id, org_role: u.org, department: u.org === 'ORG_ADMIN' ? 'IT' : 'Accounts', location: 'Head office',
        });
      }
    }
    await trx('organizations').where({ id: orgId }).update({ created_by: userIds['it.lead@acme.example'] });

    await trx('customer_addresses').insert({
      user_id: userIds['jane@example.com'], label: 'Home', line1: '4 Garden Lane', city: 'Springfield', country: 'Demo country', is_default: true,
    });
    await trx('devices').insert([
      { owner_user_id: userIds['jane@example.com'], device_type: 'LAPTOP', manufacturer: 'HP', model: 'ProBook 450 G8', operating_system: 'Windows 11', serial_number: 'HPDEMO123' },
      { organization_id: orgId, device_type: 'DESKTOP', manufacturer: 'Dell', model: 'OptiPlex 7090', operating_system: 'Windows 11', serial_number: 'DLACME001', asset_tag: 'ACME-PC-01', department: 'Accounts' },
      { organization_id: orgId, device_type: 'PRINTER', manufacturer: 'HP', model: 'LaserJet M404', serial_number: 'HPACMEPRN1', asset_tag: 'ACME-PR-01', department: 'Accounts' },
    ]);

    const catIds: Record<string, number> = {};
    let order = 10;
    for (const c of CATEGORIES) {
      const [id] = await trx('product_categories').insert({
        name: c.name, slug: c.slug, parent_id: 'parent' in c ? catIds[c.parent as string] : null, sort_order: order,
      });
      catIds[c.slug] = id as number;
      order += 10;
    }
    for (const p of PRODUCTS) {
      const [id] = await trx('products').insert({
        sku: p.sku, name: p.name, slug: slugify(p.name), category_id: catIds[p.cat], price_minor: p.price,
        description: `${p.name}. ${p.compat ?? 'Professionally tested before sale.'}`, condition: p.condition ?? 'NEW', brand: p.brand,
        warranty_months: p.warranty ?? 12, warranty_info: `${p.warranty ?? 12}-month warranty against manufacturing defects.`,
        compatibility: p.compat ?? null, specifications: JSON.stringify(p.specs), is_featured: !!p.featured, is_spare_part: !!p.spare,
      });
      await trx('inventory').insert({ product_id: id, quantity_on_hand: p.stock, quantity_reserved: 0, reorder_level: 2 });
      await trx('inventory_movements').insert({
        product_id: id, movement_type: 'RECEIPT', on_hand_delta: p.stock, reserved_delta: 0, on_hand_after: p.stock, reserved_after: 0,
        reference_type: 'OPENING_STOCK', reason: 'Opening stock (demo data)', performed_by: userIds['store@dante.local'],
      });
    }
    await trx('suppliers').insert([
      { name: 'TechParts Distribution', contact_name: 'Rita Parts', email: 'orders@techparts.example', phone: '+000 222 333' },
      { name: 'NetGear Wholesale', contact_name: 'Ned Net', email: 'sales@netwholesale.example' },
    ]);
  });
}
