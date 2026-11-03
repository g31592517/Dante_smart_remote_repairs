import type { Knex } from 'knex';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, ROLES, type RoleCode } from '@dante/shared';
import { DEFAULT_SETTINGS } from '../../modules/settings/settings.defaults.js';

const ROLE_INFO: Record<RoleCode, { name: string; description: string; isStaff: boolean }> = {
  CUSTOMER: { name: 'Customer', description: 'Individual or corporate customer', isStaff: false },
  ADMIN: { name: 'Administrator', description: 'Full access including settings and staff management', isStaff: true },
  SUPPORT_MANAGER: { name: 'Support manager', description: 'Runs the service desk: review, assign, quote, report', isStaff: true },
  TECHNICIAN: { name: 'Technician', description: 'Works assigned jobs, remote sessions, diagnostics and repairs', isStaff: true },
  INVENTORY_MANAGER: { name: 'Inventory / store manager', description: 'Catalogue, stock, suppliers, purchasing and order fulfilment', isStaff: true },
  FINANCE_OFFICER: { name: 'Finance officer', description: 'Payments, refunds and financial reports', isStaff: true },
};

export const SERVICE_CATEGORIES: { name: string; description: string; type: string; icon: string }[] = [
  { name: 'Email configuration and access', description: 'Mailbox set-up, sign-in problems, Outlook/Gmail sync, mobile mail', type: 'REMOTE_SUPPORT', icon: 'mail' },
  { name: 'Software installation and updates', description: 'Installing, updating or licensing applications', type: 'REMOTE_SUPPORT', icon: 'download' },
  { name: 'Operating system troubleshooting', description: 'Windows/macOS/Linux errors, boot problems, updates', type: 'REMOTE_SUPPORT', icon: 'monitor' },
  { name: 'Computer performance problems', description: 'Slow start-up, freezing, high disk or memory usage', type: 'REMOTE_SUPPORT', icon: 'gauge' },
  { name: 'Network and internet connectivity', description: 'Wi-Fi, LAN, router and internet access problems', type: 'ONSITE_SUPPORT', icon: 'wifi' },
  { name: 'Printer configuration', description: 'Printer installation, drivers, sharing and print errors', type: 'REMOTE_SUPPORT', icon: 'printer' },
  { name: 'User accounts and permissions', description: 'Access rights, shared folders, password and account problems', type: 'REMOTE_SUPPORT', icon: 'users' },
  { name: 'Software configuration problems', description: 'Misconfigured applications, settings and integrations', type: 'REMOTE_SUPPORT', icon: 'settings' },
  { name: 'Virus and malware', description: 'Infections, pop-ups, suspicious behaviour, security clean-up', type: 'REMOTE_SUPPORT', icon: 'shield' },
  { name: 'Hardware failure', description: 'Device does not power on, broken screen, keyboard, battery, disk, etc.', type: 'HARDWARE_REPAIR', icon: 'wrench' },
  { name: 'Other ICT problems', description: 'Anything else — describe it and we will route it', type: 'CONSULTATION', icon: 'help' },
];

/** Idempotent: safe to run on every deployment. Never overwrites settings an admin has changed. */
export async function seedReference(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    for (const code of Object.values(ROLES)) {
      const info = ROLE_INFO[code];
      await trx('roles')
        .insert({ code, name: info.name, description: info.description, is_staff: info.isStaff })
        .onConflict('code')
        .merge(['name', 'description', 'is_staff']);
    }
    for (const code of ALL_PERMISSIONS) {
      await trx('permissions').insert({ code }).onConflict('code').ignore();
    }
    const roles = await trx('roles').select('id', 'code');
    const perms = await trx('permissions').select('id', 'code');
    const permId = new Map(perms.map((p) => [p.code as string, p.id as number]));
    // Role → permission mapping is code-defined: replace it wholesale so removals take effect too.
    await trx('role_permissions').del();
    for (const role of roles) {
      const codes = ROLE_PERMISSIONS[role.code as RoleCode] ?? [];
      if (codes.length) {
        await trx('role_permissions').insert(codes.map((c) => ({ role_id: role.id, permission_id: permId.get(c) })));
      }
    }
    let order = 10;
    for (const c of SERVICE_CATEGORIES) {
      await trx('service_categories')
        .insert({ name: c.name, description: c.description, default_service_type: c.type, icon: c.icon, sort_order: order })
        .onConflict('name')
        .ignore();
      order += 10;
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await trx('system_settings').insert({ key, value: JSON.stringify(value) }).onConflict('key').ignore();
    }
  });
}
