import { describe, expect, it } from 'vitest';
import { allowedTransitions, anyDeskUrl, ANYDESK_ADDRESS_RE, canTransition, normalizeAnyDeskAddress } from './workflow.js';
import { computeTotals, taxOf } from './money.js';
import { authorizeRemoteSessionSchema, createSupportRequestSchema } from './schemas.js';

describe('request state machine', () => {
  it('keeps remote support out of workshop stages', () => {
    expect(allowedTransitions('REMOTE_SUPPORT', 'DIAGNOSIS_IN_PROGRESS')).not.toContain('REPAIR_IN_PROGRESS');
    expect(canTransition('REMOTE_SUPPORT', 'APPROVED', 'AWAITING_PARTS')).toBe(false);
    expect(canTransition('REMOTE_SUPPORT', 'DIAGNOSIS_IN_PROGRESS', 'COMPLETED')).toBe(true);
  });
  it('lets hardware repairs pass through the full workshop flow', () => {
    const path = [
      'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'ASSIGNED', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_QUOTATION_APPROVAL',
      'APPROVED', 'AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'TESTING_QC', 'AWAITING_PAYMENT', 'READY_FOR_COLLECTION',
      'COMPLETED', 'CLOSED',
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(canTransition('HARDWARE_REPAIR', path[i - 1]!, path[i]!), `${path[i - 1]} -> ${path[i]}`).toBe(true);
    }
  });
  it('does not offer collection for on-site jobs', () => {
    expect(allowedTransitions('ONSITE_SUPPORT', 'TESTING_QC')).not.toContain('READY_FOR_COLLECTION');
  });
  it('has no exits from terminal states', () => {
    expect(allowedTransitions('HARDWARE_REPAIR', 'CLOSED')).toEqual([]);
    expect(allowedTransitions('REMOTE_SUPPORT', 'CANCELLED')).toEqual([]);
  });
});

describe('AnyDesk addresses', () => {
  it('normalises spaced numeric IDs and builds the documented URL handler', () => {
    expect(normalizeAnyDeskAddress('123 456 789')).toBe('123456789');
    expect(anyDeskUrl('123 456 789')).toBe('anydesk:123456789');
    expect(anyDeskUrl('Office-PC@ad')).toBe('anydesk:office-pc@ad');
  });
  it('rejects things that are not IDs or aliases', () => {
    for (const bad of ['12345', 'password123!', 'javascript:alert(1)', 'a b@ad', '12345678901234']) {
      expect(ANYDESK_ADDRESS_RE.test(normalizeAnyDeskAddress(bad)), bad).toBe(false);
    }
  });
  it('requires explicit consent', () => {
    expect(authorizeRemoteSessionSchema.safeParse({ anydeskAddress: '123456789', consent: false, consentVersion: 'v1' }).success).toBe(false);
    expect(authorizeRemoteSessionSchema.safeParse({ anydeskAddress: '123 456 789', consent: true, consentVersion: 'v1' }).success).toBe(true);
  });
});

describe('money', () => {
  it('computes exclusive and inclusive tax in minor units', () => {
    expect(taxOf(10000, 1600, false)).toBe(1600);
    expect(taxOf(11600, 1600, true)).toBe(1600);
    expect(computeTotals([5000, 2500], 1000, false, 500)).toEqual({ subtotalMinor: 8000, taxMinor: 800, totalMinor: 8800 });
    expect(computeTotals([5000], 0, false)).toEqual({ subtotalMinor: 5000, taxMinor: 0, totalMinor: 5000 });
  });
});

describe('support request schema', () => {
  const base = {
    serviceType: 'HARDWARE_REPAIR', categoryId: 1, title: 'Laptop will not boot', description: 'Black screen after the logo appears',
    contactName: 'A B', contactEmail: 'a@b.co', contactPhone: '+254 700 000000',
  };
  it('requires device details for hardware repairs', () => {
    expect(createSupportRequestSchema.safeParse(base).success).toBe(false);
    expect(createSupportRequestSchema.safeParse({ ...base, device: { deviceType: 'LAPTOP' } }).success).toBe(true);
  });
  it('requires a site address for on-site support', () => {
    expect(createSupportRequestSchema.safeParse({ ...base, serviceType: 'ONSITE_SUPPORT' }).success).toBe(false);
  });
});
