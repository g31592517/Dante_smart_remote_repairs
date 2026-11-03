/**
 * Service-request lifecycle. The API enforces these transitions; clients use them to show the
 * actions that are currently possible. See docs/02_ARCHITECTURE.md §4 for the diagrams.
 */

export const SERVICE_TYPES = {
  REMOTE_SUPPORT: 'REMOTE_SUPPORT',
  HARDWARE_REPAIR: 'HARDWARE_REPAIR',
  ONSITE_SUPPORT: 'ONSITE_SUPPORT',
  CONSULTATION: 'CONSULTATION',
} as const;
export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES];
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  REMOTE_SUPPORT: 'Remote ICT support',
  HARDWARE_REPAIR: 'Hardware repair',
  ONSITE_SUPPORT: 'On-site ICT support',
  CONSULTATION: 'ICT consultation / other service',
};

export const REQUEST_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'ASSIGNED',
  'AWAITING_CUSTOMER',
  'DIAGNOSIS_IN_PROGRESS',
  'AWAITING_QUOTATION_APPROVAL',
  'APPROVED',
  'AWAITING_PARTS',
  'REPAIR_IN_PROGRESS',
  'TESTING_QC',
  'AWAITING_PAYMENT',
  'READY_FOR_COLLECTION',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  ACCEPTED: 'Accepted',
  ASSIGNED: 'Technician assigned',
  AWAITING_CUSTOMER: 'Awaiting your response',
  DIAGNOSIS_IN_PROGRESS: 'Diagnosis in progress',
  AWAITING_QUOTATION_APPROVAL: 'Awaiting quotation approval',
  APPROVED: 'Approved',
  AWAITING_PARTS: 'Awaiting parts',
  REPAIR_IN_PROGRESS: 'Repair in progress',
  TESTING_QC: 'Testing & quality check',
  AWAITING_PAYMENT: 'Awaiting payment',
  READY_FOR_COLLECTION: 'Ready for collection / delivery',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const TERMINAL_STATUSES: RequestStatus[] = ['CLOSED', 'CANCELLED'];
/** Statuses during which work is happening — used for "active jobs" counts. */
export const ACTIVE_WORK_STATUSES: RequestStatus[] = [
  'ASSIGNED', 'AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_QUOTATION_APPROVAL', 'APPROVED',
  'AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'TESTING_QC',
];

/** Physical-workshop stages: not available to remote support or consultations. */
const WORKSHOP_ONLY: RequestStatus[] = ['AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'TESTING_QC', 'READY_FOR_COLLECTION'];

// Staff may cancel any open request (customers only before work starts — see CUSTOMER_CANCELLABLE);
// installed parts stay recorded, reserved parts are released.
const BASE_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW', 'CANCELLED'],
  UNDER_REVIEW: ['ACCEPTED', 'AWAITING_CUSTOMER', 'CANCELLED'],
  ACCEPTED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'CANCELLED'],
  AWAITING_CUSTOMER: ['UNDER_REVIEW', 'ASSIGNED', 'DIAGNOSIS_IN_PROGRESS', 'CANCELLED'],
  DIAGNOSIS_IN_PROGRESS: [
    'AWAITING_CUSTOMER', 'AWAITING_QUOTATION_APPROVAL', 'REPAIR_IN_PROGRESS', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED',
  ],
  AWAITING_QUOTATION_APPROVAL: ['APPROVED', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_CUSTOMER', 'CANCELLED'],
  APPROVED: ['AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'],
  AWAITING_PARTS: ['REPAIR_IN_PROGRESS', 'AWAITING_QUOTATION_APPROVAL', 'CANCELLED'],
  REPAIR_IN_PROGRESS: ['AWAITING_PARTS', 'AWAITING_QUOTATION_APPROVAL', 'TESTING_QC', 'CANCELLED'],
  TESTING_QC: ['REPAIR_IN_PROGRESS', 'AWAITING_PAYMENT', 'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED'],
  AWAITING_PAYMENT: ['READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED'],
  READY_FOR_COLLECTION: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * Transitions that only the system performs as a side effect of a domain action, never through the
 * generic "change status" endpoint: assignment, sending a quotation, the customer approving it.
 */
export const SYSTEM_ONLY_TARGETS: RequestStatus[] = ['ASSIGNED', 'AWAITING_QUOTATION_APPROVAL', 'APPROVED'];

export function allowedTransitions(serviceType: ServiceType, from: RequestStatus): RequestStatus[] {
  const next = BASE_TRANSITIONS[from] ?? [];
  const remoteLike = serviceType === 'REMOTE_SUPPORT' || serviceType === 'CONSULTATION';
  return next.filter((to) => {
    if (remoteLike && WORKSHOP_ONLY.includes(to)) return false;
    // On-site jobs are finished at the customer's premises: nothing to collect.
    if (serviceType === 'ONSITE_SUPPORT' && to === 'READY_FOR_COLLECTION') return false;
    return true;
  });
}

export function canTransition(serviceType: ServiceType, from: RequestStatus, to: RequestStatus): boolean {
  return allowedTransitions(serviceType, from).includes(to);
}

/** Statuses in which the customer may still cancel without staff involvement (no work done yet). */
export const CUSTOMER_CANCELLABLE: RequestStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'AWAITING_CUSTOMER'];

export const URGENCY_LEVELS = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const CONTACT_METHODS = ['EMAIL', 'PHONE', 'WHATSAPP', 'IN_APP'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const DEVICE_TYPES = ['DESKTOP', 'LAPTOP', 'PRINTER', 'ROUTER', 'SWITCH', 'SERVER', 'PHONE_TABLET', 'OTHER'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  DESKTOP: 'Desktop computer',
  LAPTOP: 'Laptop',
  PRINTER: 'Printer',
  ROUTER: 'Router',
  SWITCH: 'Network switch',
  SERVER: 'Server',
  PHONE_TABLET: 'Phone / tablet',
  OTHER: 'Other equipment',
};

/* ---------------- remote support sessions ---------------- */

/**
 * REQUESTED  → technician asked the customer to prepare (AnyDesk ID + consent)
 * AUTHORIZED → customer supplied the AnyDesk ID and explicitly consented
 * INITIATED  → technician launched AnyDesk (clicked Connect); connection not yet confirmed
 * ACTIVE     → technician confirmed the customer accepted, or the AnyDesk API reports it active
 * COMPLETED  → technician recorded the outcome
 * REVOKED    → customer withdrew authorization before completion
 * CANCELLED  → staff cancelled the session
 */
export const REMOTE_SESSION_STATUSES = ['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE', 'COMPLETED', 'REVOKED', 'CANCELLED'] as const;
export type RemoteSessionStatus = (typeof REMOTE_SESSION_STATUSES)[number];
export const REMOTE_SESSION_TRANSITIONS: Record<RemoteSessionStatus, RemoteSessionStatus[]> = {
  REQUESTED: ['AUTHORIZED', 'CANCELLED', 'REVOKED'],
  AUTHORIZED: ['INITIATED', 'REVOKED', 'CANCELLED'],
  INITIATED: ['ACTIVE', 'COMPLETED', 'REVOKED', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'REVOKED'],
  COMPLETED: [],
  REVOKED: [],
  CANCELLED: [],
};

/**
 * AnyDesk addresses: a numeric ID (9–10 digits, shown with spaces in the client) or an alias such as
 * "name@ad" / "name@namespace". Anything else (in particular anything that looks like a password) is rejected.
 */
export const ANYDESK_ADDRESS_RE = /^(\d{9,10}|[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63})$/i;
export function normalizeAnyDeskAddress(input: string): string {
  const trimmed = input.trim();
  // AnyDesk displays IDs grouped by spaces, e.g. "123 456 789".
  return /^[\d\s]+$/.test(trimmed) ? trimmed.replace(/\s+/g, '') : trimmed.toLowerCase();
}
/** The documented AnyDesk URL handler: anydesk:<id-or-alias>. */
export function anyDeskUrl(address: string): string {
  return `anydesk:${normalizeAnyDeskAddress(address)}`;
}

/* ---------------- quotations, orders, payments ---------------- */

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'SUPERSEDED', 'EXPIRED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_ITEM_TYPES = ['DIAGNOSIS', 'SERVICE', 'LABOUR', 'PART', 'OTHER'] as const;
export type QuotationItemType = (typeof QUOTATION_ITEM_TYPES)[number];

export const ORDER_STATUSES = [
  'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'READY_FOR_COLLECTION', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  PROCESSING: 'Being prepared',
  READY_FOR_COLLECTION: 'Ready for collection',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // PROCESSING before payment only for pay-on-collection orders (cash / card at the counter) — enforced by the API
  PENDING_PAYMENT: ['PAID', 'PROCESSING', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_FOR_COLLECTION', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_COLLECTION: ['COMPLETED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const FULFILMENT_METHODS = ['COLLECTION', 'DELIVERY'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** Offline methods are recorded/verified by staff; GATEWAY goes through the configured provider. */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD_ON_SITE', 'GATEWAY'] as const;
/** Paid in person when the customer collects. */
export const PAY_ON_COLLECTION_METHODS = ['CASH', 'CARD_ON_SITE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  MOBILE_MONEY: 'Mobile money',
  CARD_ON_SITE: 'Card (at our office)',
  GATEWAY: 'Online payment',
};
export const PAYABLE_TYPES = ['SALES_ORDER', 'SUPPORT_REQUEST'] as const;
export type PayableType = (typeof PAYABLE_TYPES)[number];

/* ---------------- inventory ---------------- */

export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT', // purchase/restock received
  'ADJUSTMENT', // manual correction (+/-), reason required
  'RESERVATION', // reserved for a sales order or approved repair
  'RESERVATION_RELEASE', // reservation cancelled
  'SALE', // consumed by a fulfilled sales order
  'REPAIR_CONSUMPTION', // consumed by a repair (part installed)
  'RETURN', // returned to stock
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Lifecycle of a stock line attached to an order item or a repair part. */
export const STOCK_LINE_STATES = ['NONE', 'RESERVED', 'CONSUMED', 'RELEASED'] as const;
export type StockLineState = (typeof STOCK_LINE_STATES)[number];

export const PRODUCT_CONDITIONS = ['NEW', 'REFURBISHED', 'USED'] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];

export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
