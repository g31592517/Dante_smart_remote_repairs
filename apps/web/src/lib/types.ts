import type { OrderStatus, PaymentMethod, PaymentStatus, QuotationStatus, RemoteSessionStatus, RequestStatus, ServiceType } from '@dante/shared';

/** Response shapes of the API, as consumed by the web app (see /api/docs for the full contract). */

export interface RequestSummary {
  id: number;
  reference: string;
  title: string;
  serviceType: ServiceType;
  status: RequestStatus;
  urgency: string;
  submittedAt: string;
  updatedAt: string;
  category: string;
  technicianName: string | null;
  customerName: string;
  contactName: string;
  organizationName: string | null;
  department: string | null;
}

export interface Payment {
  id: number;
  reference: string;
  payableType: 'SALES_ORDER' | 'SUPPORT_REQUEST';
  payableId: number;
  method: PaymentMethod;
  status: PaymentStatus;
  currency: string;
  amountMinor: number;
  provider: string;
  providerReference: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  succeededAt: string | null;
  refundedAt: string | null;
  note?: string | null;
  customerName?: string;
  payableReference?: string;
}

export interface Balance {
  dueMinor: number;
  paidMinor: number;
  outstandingMinor: number;
}

export interface RemoteSession {
  id: number;
  status: RemoteSessionStatus;
  instructions: string | null;
  anydeskAddress: string | null;
  anydeskUrl?: string;
  requestedAt: string;
  authorizedAt: string | null;
  initiatedAt: string | null;
  activeAt: string | null;
  completedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  outcome: string | null;
  workPerformed: string | null;
  evidence: { source: 'NONE' | 'MANUAL' | 'ANYDESK_API'; anydeskSessionId: string | null; startedAt: string | null; endedAt: string | null; durationSeconds: number | null; apiSyncedAt: string | null };
}

export interface Quotation {
  id: number;
  reference: string;
  revision: number;
  status: QuotationStatus;
  currency: string;
  subtotalMinor: number;
  taxRateBasisPoints: number;
  taxInclusive: boolean;
  taxMinor: number;
  totalMinor: number;
  expectedDurationDays: number | null;
  validUntil: string;
  notes: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  preparedBy: string;
  items: { id: number; itemType: string; description: string; productId: number | null; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
}

export interface RequestDetail {
  id: number;
  reference: string;
  serviceType: ServiceType;
  status: RequestStatus;
  title: string;
  description: string;
  errorMessages: string | null;
  urgency: string;
  preferredContact: string;
  contact: { name: string; email: string; phone: string; department: string | null; location: string | null };
  siteAddress: string | null;
  preferredVisitDate: string | null;
  category: { id: number; name: string };
  device: { id: number; deviceType: string; manufacturer: string | null; model: string | null; operatingSystem: string | null; serialNumber: string | null; assetTag: string | null } | null;
  customer: { id: number; name: string; email: string; phone: string | null } | null;
  organization: { id: number; name: string } | null;
  technician: { id: number; name: string; email?: string } | null;
  dates: Record<'submittedAt' | 'firstResponseAt' | 'acceptedAt' | 'assignedAt' | 'completedAt' | 'closedAt' | 'cancelledAt', string | null>;
  cancelReason: string | null;
  timeline: { id: number; type: string; message: string; createdAt: string; visibleToCustomer: boolean; actor: string | null }[];
  attachments: { id: number; context: string; name: string; mimeType: string; sizeBytes: number; createdAt: string; visibleToCustomer: boolean }[];
  remoteSessions: RemoteSession[];
  anydeskDownloadUrl: string;
  remoteConsent: { version: string; text: string };
  repairJob: {
    intakeType: 'WORKSHOP' | 'ONSITE'; appointmentAt: string | null; receivedAt: string | null; conditionNotes: string | null; accessories: string | null;
    serialNumber: string | null; customerAcknowledgedAt: string | null; acknowledgedByName: string | null; returnedAt: string | null; returnedTo: string | null;
  } | null;
  diagnostics: { id: number; findings: string; rootCause: string | null; recommendedAction: string | null; createdAt: string; technician: string; visibleToCustomer: boolean }[];
  workLogs: { id: number; activity: string; minutesSpent?: number; createdAt: string; technician: string; visibleToCustomer: boolean }[];
  quotations: Quotation[];
  parts: { id: number; productId: number; productName: string; sku: string; quantity: number; stockState: string; awaitingStock: boolean; consumedAt: string | null; chargeable: boolean }[];
  report: {
    originalProblem: string; diagnosis: string; actionsPerformed: string; changesMade: string | null; partsReplaced: { name: string; sku: string; quantity: number; chargeable: boolean }[];
    testingResults: string; remoteSessions: { id: number; outcome: string; anydeskSessionId: string | null; startedAt: string | null; endedAt: string | null; durationSeconds: number | null; source: string }[];
    recommendations: string | null; warrantyDays: number; warrantyTerms: string | null; outcome: string; submittedAt: string;
  } | null;
  warranty: { startsOn: string; endsOn: string; terms: string | null } | null;
  feedback: { rating: number; issueResolved: boolean; comment: string | null; createdAt: string } | null;
  balance: Balance;
  payments: Payment[];
  currency: { code: string; minorDigits: number };
  permissions: { viewer: 'CUSTOMER' | 'TECHNICIAN' | 'MANAGER'; canManage: boolean; canAssign: boolean; canWork: boolean; canViewInternalNotes: boolean; nextStatuses: RequestStatus[] };
}

export interface Message {
  id: number;
  body: string;
  fromStaff: boolean;
  createdAt: string;
  sender: { id: number; name: string };
  attachments: { id: number; name: string; mimeType: string; sizeBytes: number }[];
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  slug: string;
  categoryId: number;
  categoryName: string;
  description: string;
  priceMinor: number;
  condition: 'NEW' | 'REFURBISHED' | 'USED';
  brand: string | null;
  warrantyMonths: number;
  warrantyInfo: string | null;
  compatibility: string | null;
  specifications: Record<string, string>;
  isActive: boolean;
  isFeatured: boolean;
  isSparePart: boolean;
  images: { id: number; url: string; alt: string }[];
  stock: { status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'; available: number; onHand?: number; reserved?: number; reorderLevel?: number };
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  description: string | null;
  productCount: number;
}

export interface Cart {
  items: { productId: number; name: string; sku: string; slug: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; available: number; imageUrl: string | null; problem: string | null }[];
  itemCount: number;
  subtotalMinor: number;
  canCheckout: boolean;
}

export interface OrderSummary {
  id: number;
  reference: string;
  status: OrderStatus;
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY';
  paymentMethod: PaymentMethod;
  totalMinor: number;
  currency: string;
  placedAt: string;
  paidAt: string | null;
  customerName: string;
  itemCount: number;
}

export interface OrderDetail {
  id: number;
  reference: string;
  status: OrderStatus;
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY';
  paymentMethod: PaymentMethod;
  deliveryAddress: Record<string, string | null> | null;
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  taxRateBasisPoints: number;
  taxInclusive: boolean;
  totalMinor: number;
  customerNote: string | null;
  placedAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  customer: { name: string; email: string; phone: string | null } | null;
  items: { id: number; productId: number; name: string; sku: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; stockState?: string }[];
  history: { from: string | null; to: string; note: string | null; at: string }[];
  payments: Payment[];
  balance: Balance;
  paymentInstructions: string | null;
  nextStatuses: OrderStatus[];
  canCancel: boolean;
}

export interface Address {
  id: number;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface Device {
  id: number;
  deviceType: string;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  serialNumber: string | null;
  assetTag: string | null;
  department: string | null;
  location: string | null;
  organizationId: number | null;
}

export interface ServiceCategory {
  id: number;
  name: string;
  description: string | null;
  defaultServiceType: ServiceType | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
