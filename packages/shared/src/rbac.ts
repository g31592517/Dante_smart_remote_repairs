/**
 * Roles and permissions. The database is seeded from these constants (apps/api seeds), and the
 * web/mobile clients use them only to decide what to *show* — the API is the enforcement point.
 */

export const ROLES = {
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
  SUPPORT_MANAGER: 'SUPPORT_MANAGER',
  TECHNICIAN: 'TECHNICIAN',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
} as const;
export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
export const STAFF_ROLES: RoleCode[] = [
  ROLES.ADMIN,
  ROLES.SUPPORT_MANAGER,
  ROLES.TECHNICIAN,
  ROLES.INVENTORY_MANAGER,
  ROLES.FINANCE_OFFICER,
];

export const PERMISSIONS = {
  // support desk
  REQUESTS_VIEW_ALL: 'requests.view_all',
  REQUESTS_MANAGE: 'requests.manage',
  REQUESTS_ASSIGN: 'requests.assign',
  REQUESTS_WORK: 'requests.work', // act on requests assigned to me
  INTERNAL_NOTES_VIEW: 'internal_notes.view',
  REMOTE_OPERATE: 'remote.operate',
  REMOTE_VIEW_ALL: 'remote.view_all',
  QUOTATIONS_PREPARE: 'quotations.prepare',
  QUOTATIONS_REVIEW: 'quotations.review',
  CATEGORIES_MANAGE: 'categories.manage',
  // people
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  ORGANIZATIONS_MANAGE: 'organizations.manage',
  TECHNICIANS_PERFORMANCE: 'technicians.performance',
  USERS_MANAGE: 'users.manage',
  // store
  PRODUCTS_MANAGE: 'products.manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  PURCHASING_MANAGE: 'purchasing.manage',
  ORDERS_VIEW_ALL: 'orders.view_all',
  ORDERS_MANAGE: 'orders.manage',
  // money
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_RECORD: 'payments.record',
  PAYMENTS_REFUND: 'payments.refund',
  // reporting & admin
  REPORTS_OPERATIONAL: 'reports.operational',
  REPORTS_INVENTORY: 'reports.inventory',
  REPORTS_FINANCIAL: 'reports.financial',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
} as const;
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

const P = PERMISSIONS;
export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  CUSTOMER: [],
  ADMIN: ALL_PERMISSIONS,
  SUPPORT_MANAGER: [
    P.REQUESTS_VIEW_ALL, P.REQUESTS_MANAGE, P.REQUESTS_ASSIGN, P.REQUESTS_WORK, P.INTERNAL_NOTES_VIEW,
    P.REMOTE_OPERATE, P.REMOTE_VIEW_ALL, P.QUOTATIONS_PREPARE, P.QUOTATIONS_REVIEW, P.CATEGORIES_MANAGE,
    P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE, P.ORGANIZATIONS_MANAGE, P.TECHNICIANS_PERFORMANCE,
    P.INVENTORY_VIEW, P.ORDERS_VIEW_ALL, P.PAYMENTS_VIEW, P.REPORTS_OPERATIONAL,
  ],
  TECHNICIAN: [P.REQUESTS_WORK, P.INTERNAL_NOTES_VIEW, P.REMOTE_OPERATE, P.QUOTATIONS_PREPARE, P.INVENTORY_VIEW],
  INVENTORY_MANAGER: [
    P.PRODUCTS_MANAGE, P.INVENTORY_VIEW, P.INVENTORY_MANAGE, P.SUPPLIERS_MANAGE, P.PURCHASING_MANAGE,
    P.ORDERS_VIEW_ALL, P.ORDERS_MANAGE, P.REPORTS_INVENTORY,
  ],
  FINANCE_OFFICER: [
    P.PAYMENTS_VIEW, P.PAYMENTS_RECORD, P.PAYMENTS_REFUND, P.ORDERS_VIEW_ALL, P.CUSTOMERS_VIEW, P.REPORTS_FINANCIAL,
  ],
};

export const ORG_ROLES = { ORG_ADMIN: 'ORG_ADMIN', ORG_MEMBER: 'ORG_MEMBER' } as const;
export type OrgRole = (typeof ORG_ROLES)[keyof typeof ORG_ROLES];
