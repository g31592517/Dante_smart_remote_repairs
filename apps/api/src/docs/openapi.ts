import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, type ZodType } from 'zod';
import * as S from '@dante/shared';

extendZodWithOpenApi(z);

/**
 * Endpoint catalogue → OpenAPI 3. Request bodies and queries reference the SAME zod schemas the API
 * validates with (from @dante/shared), so the documentation cannot drift from the validation.
 * Every response uses the envelope { data, meta? } / { error: { code, message, details? } }.
 */
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Op {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth?: 'none' | 'optional' | 'required';
  permission?: string;
  body?: ZodType;
  query?: ZodType;
  multipart?: string;
  raw?: boolean;
}

const page = z.object({ page: z.number().int().optional(), pageSize: z.number().int().optional(), q: z.string().optional() });
const anyObj = z.object({}).passthrough();

const OPS: Op[] = [
  { method: 'get', path: '/health', tag: 'System', summary: 'Liveness + database check', auth: 'none' },

  { method: 'post', path: '/auth/register', tag: 'Auth', summary: 'Register an individual or corporate customer account', auth: 'none', body: S.registerSchema },
  { method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Sign in. Browsers get the refresh token as an httpOnly cookie; send header X-Client: mobile to receive it in the body', auth: 'none', body: S.loginSchema },
  { method: 'post', path: '/auth/refresh', tag: 'Auth', summary: 'Rotate the refresh token and get a new access token (cookie or body)', auth: 'none', body: S.refreshSchema },
  { method: 'post', path: '/auth/logout', tag: 'Auth', summary: 'Revoke the refresh-token family', auth: 'none', body: S.refreshSchema },
  { method: 'post', path: '/auth/forgot-password', tag: 'Auth', summary: 'E-mail a one-hour password reset link (always 200)', auth: 'none', body: S.forgotPasswordSchema },
  { method: 'post', path: '/auth/reset-password', tag: 'Auth', summary: 'Set a new password with a reset token; revokes all sessions', auth: 'none', body: S.resetPasswordSchema },
  { method: 'post', path: '/auth/accept-invite', tag: 'Auth', summary: 'Invited employee/staff sets their password', auth: 'none', body: S.acceptInviteSchema },
  { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Current user with roles, permissions and organisation' },
  { method: 'post', path: '/auth/change-password', tag: 'Auth', summary: 'Change password (revokes other sessions)', body: S.changePasswordSchema },

  { method: 'get', path: '/account/profile', tag: 'Account', summary: 'My profile' },
  { method: 'patch', path: '/account/profile', tag: 'Account', summary: 'Update my profile', body: S.updateProfileSchema },
  { method: 'get', path: '/account/addresses', tag: 'Account', summary: 'My delivery addresses' },
  { method: 'post', path: '/account/addresses', tag: 'Account', summary: 'Add an address', body: S.addressSchema },
  { method: 'put', path: '/account/addresses/{id}', tag: 'Account', summary: 'Replace an address', body: S.addressSchema },
  { method: 'delete', path: '/account/addresses/{id}', tag: 'Account', summary: 'Delete an address' },
  { method: 'get', path: '/account/devices', tag: 'Account', summary: 'My devices (plus my organisation\'s devices)' },
  { method: 'post', path: '/account/devices', tag: 'Account', summary: 'Register a device', body: S.deviceSchema },
  { method: 'patch', path: '/account/devices/{id}', tag: 'Account', summary: 'Update a device', body: S.deviceSchema.partial() },
  { method: 'get', path: '/account/devices/{id}/history', tag: 'Account', summary: 'Repair/service history of a device' },
  { method: 'get', path: '/account/consents', tag: 'Account', summary: 'Consents I have given (terms, remote access, intake)' },

  { method: 'get', path: '/organizations/mine', tag: 'Organizations', summary: 'My organisation (members listed for org admins)' },
  { method: 'patch', path: '/organizations/mine', tag: 'Organizations', summary: 'Update my organisation (org admin)', body: S.organizationUpdateSchema },
  { method: 'post', path: '/organizations/mine/members', tag: 'Organizations', summary: 'Invite an employee (org admin)', body: S.inviteMemberSchema },
  { method: 'patch', path: '/organizations/mine/members/{id}', tag: 'Organizations', summary: 'Change an employee\'s role/department/active state (org admin)', body: S.updateMemberSchema },
  { method: 'get', path: '/organizations', tag: 'Organizations', summary: 'All organisations (staff)', permission: 'organizations.manage | customers.view', query: page },
  { method: 'get', path: '/organizations/{id}', tag: 'Organizations', summary: 'Organisation detail (staff)', permission: 'organizations.manage | customers.view' },
  { method: 'patch', path: '/organizations/{id}', tag: 'Organizations', summary: 'Update/deactivate an organisation (staff)', permission: 'organizations.manage', body: S.organizationUpdateSchema },

  { method: 'get', path: '/staff/users', tag: 'Staff administration', summary: 'List customers (kind=customers) or staff (kind=staff)', permission: 'users.manage | customers.view', query: page.extend({ kind: z.enum(['staff', 'customers']).optional() }) },
  { method: 'get', path: '/staff/users/{id}', tag: 'Staff administration', summary: 'User detail with recent requests and orders', permission: 'users.manage | customers.view' },
  { method: 'post', path: '/staff/users', tag: 'Staff administration', summary: 'Create a staff member (invitation e-mailed)', permission: 'users.manage', body: S.createStaffSchema },
  { method: 'put', path: '/staff/users/{id}/roles', tag: 'Staff administration', summary: 'Replace a user\'s roles', permission: 'users.manage', body: S.updateUserRolesSchema },
  { method: 'put', path: '/staff/users/{id}/active', tag: 'Staff administration', summary: 'Activate/deactivate a user (revokes sessions)', permission: 'users.manage | customers.manage', body: S.setUserActiveSchema },
  { method: 'get', path: '/staff/technicians', tag: 'Staff administration', summary: 'Technicians with current workload', permission: 'requests.assign | requests.view_all' },
  { method: 'patch', path: '/staff/technicians/{userId}', tag: 'Staff administration', summary: 'Technician availability / specialities', permission: 'requests.assign | users.manage', body: anyObj },

  { method: 'get', path: '/settings/public', tag: 'Settings', summary: 'Public business settings (contact, currency, consent texts, AnyDesk download URL)', auth: 'none' },
  { method: 'get', path: '/settings/service-categories', tag: 'Settings', summary: 'Support categories (all=true for managers)', auth: 'optional' },
  { method: 'post', path: '/settings/service-categories', tag: 'Settings', summary: 'Add a support category', permission: 'categories.manage', body: S.categorySchema },
  { method: 'put', path: '/settings/service-categories/{id}', tag: 'Settings', summary: 'Edit a support category', permission: 'categories.manage', body: S.categorySchema },
  { method: 'get', path: '/settings', tag: 'Settings', summary: 'All platform settings', permission: 'settings.manage' },
  { method: 'patch', path: '/settings', tag: 'Settings', summary: 'Update platform settings', permission: 'settings.manage', body: S.settingsUpdateSchema },
  { method: 'get', path: '/settings/integrations', tag: 'Settings', summary: 'Which integrations are configured (no secrets)', permission: 'settings.manage' },

  { method: 'post', path: '/requests', tag: 'Support requests', summary: 'Submit a support request (customer). Returns the request with its reference', body: S.createSupportRequestSchema },
  { method: 'get', path: '/requests', tag: 'Support requests', summary: 'List requests visible to me (own / organisation / assigned / all)', query: S.listRequestsQuery },
  { method: 'get', path: '/requests/{id}', tag: 'Support requests', summary: 'Full request view; confidential fields filtered for customers' },
  { method: 'post', path: '/requests/{id}/review', tag: 'Support requests', summary: 'Accept, ask for information, or decline', permission: 'requests.manage', body: S.reviewRequestSchema },
  { method: 'post', path: '/requests/{id}/assign', tag: 'Support requests', summary: 'Assign or reassign a technician', permission: 'requests.assign', body: S.assignSchema },
  { method: 'post', path: '/requests/{id}/status', tag: 'Support requests', summary: 'Change status (validated against the workflow for the service type)', permission: 'requests.work', body: S.changeStatusSchema },
  { method: 'post', path: '/requests/{id}/cancel', tag: 'Support requests', summary: 'Customer cancels before work starts', body: S.cancelRequestSchema },
  { method: 'post', path: '/requests/{id}/updates', tag: 'Support requests', summary: 'Post a progress update to the timeline (staff)', body: S.progressUpdateSchema },
  { method: 'get', path: '/requests/{id}/messages', tag: 'Support requests', summary: 'Conversation between customer and technician' },
  { method: 'post', path: '/requests/{id}/messages', tag: 'Support requests', summary: 'Send a message', body: S.messageSchema },
  { method: 'get', path: '/requests/{id}/notes', tag: 'Support requests', summary: 'Private internal notes (staff only)', permission: 'internal_notes.view' },
  { method: 'post', path: '/requests/{id}/notes', tag: 'Support requests', summary: 'Add a private internal note', permission: 'internal_notes.view', body: S.internalNoteSchema },

  { method: 'post', path: '/remote-sessions', tag: 'Remote support (AnyDesk)', summary: 'Ask the customer to prepare a remote session', permission: 'remote.operate', body: S.requestRemoteSessionSchema.extend({ supportRequestId: z.number().int() }) },
  { method: 'post', path: '/remote-sessions/{id}/authorize', tag: 'Remote support (AnyDesk)', summary: 'Customer provides AnyDesk ID and explicit, recorded consent', body: S.authorizeRemoteSessionSchema },
  { method: 'post', path: '/remote-sessions/{id}/revoke', tag: 'Remote support (AnyDesk)', summary: 'Customer withdraws authorisation (closes via API when available)', body: S.revokeConsentSchema },
  { method: 'post', path: '/remote-sessions/{id}/initiate', tag: 'Remote support (AnyDesk)', summary: 'Technician launches: returns { anydeskUrl: "anydesk:<id>" }. Requires valid consent', permission: 'remote.operate' },
  { method: 'post', path: '/remote-sessions/{id}/status', tag: 'Remote support (AnyDesk)', summary: 'Mark ACTIVE (customer accepted) or CANCELLED', permission: 'remote.operate', body: S.remoteSessionStatusSchema },
  { method: 'post', path: '/remote-sessions/{id}/complete', tag: 'Remote support (AnyDesk)', summary: 'Record outcome; session evidence from the AnyDesk API when configured, else manual', permission: 'remote.operate', body: S.completeRemoteSessionSchema },
  { method: 'post', path: '/remote-sessions/{id}/sync', tag: 'Remote support (AnyDesk)', summary: 'Pull session data from the AnyDesk REST API', permission: 'remote.operate' },
  { method: 'get', path: '/remote-sessions/anydesk/status', tag: 'Remote support (AnyDesk)', summary: 'AnyDesk REST API connectivity check (sysinfo)', permission: 'settings.manage | remote.view_all' },

  { method: 'post', path: '/attachments', tag: 'Attachments', summary: 'Upload up to 5 files to a request (multipart: supportRequestId, context, contextId, files[])', multipart: 'files' },
  { method: 'get', path: '/attachments/{id}', tag: 'Attachments', summary: 'Download a file after an access check' },

  { method: 'get', path: '/notifications', tag: 'Notifications', summary: 'My in-app notifications (unread=true to filter)' },
  { method: 'post', path: '/notifications/read', tag: 'Notifications', summary: 'Mark notifications read ({ ids } or { all: true })', body: anyObj },

  { method: 'put', path: '/repairs/{requestId}/intake', tag: 'Repairs', summary: 'Record device intake / on-site visit and handover acknowledgment', body: S.intakeSchema },
  { method: 'post', path: '/repairs/{requestId}/intake/acknowledge', tag: 'Repairs', summary: 'Customer confirms the handover details online' },
  { method: 'post', path: '/repairs/{requestId}/diagnostics', tag: 'Repairs', summary: 'Record a diagnosis', body: S.diagnosticSchema },
  { method: 'post', path: '/repairs/{requestId}/work-logs', tag: 'Repairs', summary: 'Log troubleshooting / repair work', body: S.workLogSchema },
  { method: 'post', path: '/repairs/{requestId}/quotations', tag: 'Repairs', summary: 'Create (and optionally send) a quotation or revision', permission: 'quotations.prepare', body: S.createQuotationSchema },
  { method: 'post', path: '/repairs/quotations/{id}/send', tag: 'Repairs', summary: 'Send a draft quotation', permission: 'quotations.prepare' },
  { method: 'post', path: '/repairs/quotations/{id}/decision', tag: 'Repairs', summary: 'Customer approves (reserves parts) or declines', body: S.quotationDecisionSchema },
  { method: 'post', path: '/repairs/{requestId}/parts', tag: 'Repairs', summary: 'Request a no-charge part (reserved if in stock)', body: anyObj },
  { method: 'post', path: '/repairs/{requestId}/parts/allocate', tag: 'Repairs', summary: 'Retry reservation for parts awaiting stock' },
  { method: 'post', path: '/repairs/{requestId}/parts/{partId}/install', tag: 'Repairs', summary: 'Mark a part installed (consumes stock exactly once)' },
  { method: 'put', path: '/repairs/{requestId}/report', tag: 'Repairs', summary: 'Submit/update the final service report (creates warranty)', body: S.serviceReportSchema },
  { method: 'post', path: '/repairs/{requestId}/return', tag: 'Repairs', summary: 'Record the device being returned to the customer', body: anyObj },
  { method: 'post', path: '/repairs/{requestId}/feedback', tag: 'Repairs', summary: 'Customer rating and feedback after completion', body: S.feedbackSchema },

  { method: 'get', path: '/catalog/categories', tag: 'Catalogue', summary: 'Product categories', auth: 'none' },
  { method: 'get', path: '/catalog/products', tag: 'Catalogue', summary: 'Search / filter products', auth: 'optional', query: S.productListQuery },
  { method: 'get', path: '/catalog/products/{idOrSlug}', tag: 'Catalogue', summary: 'Product detail with images, specs and availability', auth: 'optional' },
  { method: 'post', path: '/catalog/categories', tag: 'Catalogue', summary: 'Create a product category', permission: 'products.manage', body: S.productCategorySchema },
  { method: 'put', path: '/catalog/categories/{id}', tag: 'Catalogue', summary: 'Edit a product category', permission: 'products.manage', body: S.productCategorySchema },
  { method: 'post', path: '/catalog/products', tag: 'Catalogue', summary: 'Create a product (stock starts at 0)', permission: 'products.manage', body: S.productSchema },
  { method: 'put', path: '/catalog/products/{id}', tag: 'Catalogue', summary: 'Edit a product', permission: 'products.manage', body: S.productSchema },
  { method: 'post', path: '/catalog/products/{id}/images', tag: 'Catalogue', summary: 'Upload product images (multipart field "images")', permission: 'products.manage', multipart: 'images' },
  { method: 'delete', path: '/catalog/products/{id}/images/{imageId}', tag: 'Catalogue', summary: 'Delete a product image', permission: 'products.manage' },

  { method: 'get', path: '/inventory/stock', tag: 'Inventory', summary: 'Stock levels (lowStock=true, spareParts=true, q)', permission: 'inventory.view' },
  { method: 'post', path: '/inventory/adjustments', tag: 'Inventory', summary: 'Manual stock adjustment with reason (audited)', permission: 'inventory.manage', body: S.stockAdjustmentSchema },
  { method: 'get', path: '/inventory/movements', tag: 'Inventory', summary: 'Stock movement history', permission: 'inventory.view' },
  { method: 'get', path: '/inventory/reservations/{productId}', tag: 'Inventory', summary: 'Orders and repairs holding reserved stock', permission: 'inventory.view' },
  { method: 'get', path: '/inventory/suppliers', tag: 'Inventory', summary: 'Suppliers', permission: 'suppliers.manage | purchasing.manage' },
  { method: 'post', path: '/inventory/suppliers', tag: 'Inventory', summary: 'Add supplier', permission: 'suppliers.manage', body: S.supplierSchema },
  { method: 'put', path: '/inventory/suppliers/{id}', tag: 'Inventory', summary: 'Edit supplier', permission: 'suppliers.manage', body: S.supplierSchema },
  { method: 'get', path: '/inventory/purchase-orders', tag: 'Inventory', summary: 'Purchase orders', permission: 'purchasing.manage' },
  { method: 'get', path: '/inventory/purchase-orders/{id}', tag: 'Inventory', summary: 'Purchase order detail', permission: 'purchasing.manage' },
  { method: 'post', path: '/inventory/purchase-orders', tag: 'Inventory', summary: 'Create a draft purchase order', permission: 'purchasing.manage', body: S.purchaseOrderSchema },
  { method: 'post', path: '/inventory/purchase-orders/{id}/order', tag: 'Inventory', summary: 'Mark as ordered from supplier', permission: 'purchasing.manage' },
  { method: 'post', path: '/inventory/purchase-orders/{id}/receive', tag: 'Inventory', summary: 'Receive stock (partial allowed) → RECEIPT movements', permission: 'purchasing.manage | inventory.manage', body: S.receivePurchaseOrderSchema },
  { method: 'post', path: '/inventory/purchase-orders/{id}/cancel', tag: 'Inventory', summary: 'Cancel a purchase order', permission: 'purchasing.manage' },

  { method: 'get', path: '/cart', tag: 'Cart & orders', summary: 'My cart with live prices and availability' },
  { method: 'post', path: '/cart/items', tag: 'Cart & orders', summary: 'Add to cart', body: S.cartItemSchema },
  { method: 'patch', path: '/cart/items/{productId}', tag: 'Cart & orders', summary: 'Change quantity (0 removes)', body: S.cartItemUpdateSchema },
  { method: 'delete', path: '/cart/items/{productId}', tag: 'Cart & orders', summary: 'Remove from cart' },
  { method: 'delete', path: '/cart', tag: 'Cart & orders', summary: 'Empty cart' },
  { method: 'post', path: '/orders/checkout', tag: 'Cart & orders', summary: 'Place an order: re-priced and stock-reserved atomically', body: S.checkoutSchema },
  { method: 'get', path: '/orders', tag: 'Cart & orders', summary: 'My orders (all orders for staff)', query: page },
  { method: 'get', path: '/orders/{id}', tag: 'Cart & orders', summary: 'Order detail with status history and payments' },
  { method: 'post', path: '/orders/{id}/status', tag: 'Cart & orders', summary: 'Fulfilment status (consumes stock when goods leave)', permission: 'orders.manage', body: S.orderStatusSchema },
  { method: 'post', path: '/orders/{id}/cancel', tag: 'Cart & orders', summary: 'Customer cancels an unpaid order (releases stock)', body: anyObj },

  { method: 'get', path: '/payments', tag: 'Payments', summary: 'Payments (mine, or all for finance)', query: page },
  { method: 'get', path: '/payments/{id}/transactions', tag: 'Payments', summary: 'Audit trail of a payment', permission: 'payments.view' },
  { method: 'post', path: '/payments/record', tag: 'Payments', summary: 'Record a verified offline payment', permission: 'payments.record', body: S.recordPaymentSchema },
  { method: 'post', path: '/payments/claims', tag: 'Payments', summary: 'Customer reports a transfer / mobile-money payment for verification', body: anyObj },
  { method: 'post', path: '/payments/{id}/verify', tag: 'Payments', summary: 'Approve or reject a reported payment', permission: 'payments.record', body: anyObj },
  { method: 'post', path: '/payments/checkout', tag: 'Payments', summary: 'Start a hosted gateway checkout (when a gateway is configured)', body: anyObj },
  { method: 'post', path: '/payments/{id}/refund', tag: 'Payments', summary: 'Refund a payment', permission: 'payments.refund', body: S.refundPaymentSchema },
  { method: 'post', path: '/payments/webhooks/gateway', tag: 'Payments', summary: 'Gateway webhook (raw body, signature verified, idempotent)', auth: 'none', raw: true },

  { method: 'get', path: '/reports/dashboard', tag: 'Reports', summary: 'Operational indicators for my role' },
  ...(['requests-by-category', 'requests-by-period', 'response-times', 'technician-performance', 'service-types', 'satisfaction', 'revenue', 'product-sales', 'inventory-movements', 'outstanding'] as const)
    .map((p): Op => ({ method: 'get', path: `/reports/${p}`, tag: 'Reports', summary: `${p.replace(/-/g, ' ')} (format=csv to download)`, query: S.reportRangeQuery })),
  { method: 'get', path: '/reports/audit', tag: 'Reports', summary: 'Audit log', permission: 'audit.view', query: page },
];

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  const errorSchema = registry.register('Error', z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) }));
  const envelope = z.object({ data: z.unknown(), meta: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }).optional() });

  for (const op of OPS) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    registry.registerPath({
      method: op.method,
      path: op.path,
      tags: [op.tag],
      summary: op.summary,
      description: op.permission ? `Requires permission: \`${op.permission}\`` : undefined,
      security: op.auth === 'none' ? [] : op.auth === 'optional' ? [{}, { bearer: [] }] : [{ bearer: [] }],
      request: {
        params: params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) : undefined,
        query: op.query as z.ZodObject | undefined,
        body: op.body
          ? { content: { 'application/json': { schema: op.body } } }
          : op.multipart
            ? { content: { 'multipart/form-data': { schema: z.object({ [op.multipart]: z.array(z.string()) }) } } }
            : undefined,
      },
      responses: {
        200: { description: 'Success', content: { 'application/json': { schema: envelope } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: errorSchema } } },
        401: { description: 'Not authenticated', content: { 'application/json': { schema: errorSchema } } },
        403: { description: 'Not permitted', content: { 'application/json': { schema: errorSchema } } },
        404: { description: 'Not found (also returned for records you may not see)', content: { 'application/json': { schema: errorSchema } } },
        409: { description: 'Conflict / invalid state / insufficient stock', content: { 'application/json': { schema: errorSchema } } },
      },
    });
  }
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Dante Smart Remote Repairs API',
      version: '1.0.0',
      description:
        'REST API for the IT support, remote assistance, repair and e-commerce platform. All endpoints are under /api/v1. ' +
        'Authenticate with `Authorization: Bearer <accessToken>`. Responses use `{ data, meta? }` on success and ' +
        '`{ error: { code, message, details? } }` on failure.',
    },
    servers: [{ url: '/api/v1' }],
  });
}

export const operationCount = OPS.length;
