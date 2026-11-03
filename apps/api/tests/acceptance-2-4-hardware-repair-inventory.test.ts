import { describe, expect, it } from 'vitest';
import { acceptedAndAssigned, categoryId, createProduct, db, registerCustomer, staff, stockOf, supportRequestBody } from './helpers.js';

const laptopRequest = async (overrides: Record<string, unknown> = {}) =>
  supportRequestBody({
    serviceType: 'HARDWARE_REPAIR', categoryId: await categoryId('Hardware failure'), title: 'Laptop does not boot',
    description: 'The laptop shows the logo and then a black screen. The disk light stays off.',
    device: { deviceType: 'LAPTOP', manufacturer: 'HP', model: 'ProBook 450 G8', operatingSystem: 'Windows 11', serialNumber: `SN-${Date.now()}` },
    ...overrides,
  });

/**
 * ACCEPTANCE TEST 2 — Hardware repair, and TEST 4 — repair/inventory integration.
 */
describe('Acceptance 2 & 4: hardware repair with shared inventory', () => {
  it('diagnoses, quotes, gets approval, reserves and consumes the part, reports and completes', async () => {
    const store = await staff.store();
    const tech = await staff.tech2();
    const finance = await staff.finance();
    const customer = await registerCustomer();
    const ssd = await createProduct(store, 3, 5900);
    const { id, manager } = await acceptedAndAssigned(customer, await laptopRequest(), tech.userId);

    // intake with condition, accessories and acknowledgment
    const intake = await tech.put(`/repairs/${id}/intake`, {
      intakeType: 'WORKSHOP', conditionNotes: 'Scratches on lid, all keys present', accessories: 'Charger', customerAcknowledged: true, acknowledgedByName: 'Test Customer',
    });
    expect(intake.status).toBe(200);
    expect(intake.body.data.status).toBe('DIAGNOSIS_IN_PROGRESS');
    expect(intake.body.data.repairJob.customerAcknowledgedAt).toBeTruthy();

    await tech.post(`/repairs/${id}/diagnostics`, { findings: 'SSD not detected in BIOS; drive failed SMART test on bench', rootCause: 'Failed SSD', visibleToCustomer: true });

    // technician checks availability of the shared stock (Test 4)
    const lookup = await tech.get(`/catalog/products?q=${ssd.sku}`);
    expect(lookup.body.data[0].stock.available).toBe(3);

    // chargeable repair work cannot start before an approved quotation
    expect((await tech.post(`/requests/${id}/status`, { status: 'REPAIR_IN_PROGRESS' })).status).toBe(409);

    const quote = await tech.post(`/repairs/${id}/quotations`, {
      items: [
        { itemType: 'DIAGNOSIS', description: 'Diagnostic fee', quantity: 1, unitPriceMinor: 1500 },
        { itemType: 'LABOUR', description: 'Replace SSD and reinstall Windows', quantity: 1, unitPriceMinor: 3000 },
        { itemType: 'PART', description: ssd.name, productId: ssd.id, quantity: 1, unitPriceMinor: 5900 },
      ],
      expectedDurationDays: 2, validDays: 14, send: true,
    });
    expect(quote.status).toBe(201);
    expect(quote.body.data.status).toBe('AWAITING_QUOTATION_APPROVAL');
    const q = quote.body.data.quotations[0];
    expect(q.totalMinor).toBe(10400);
    expect(await stockOf(ssd.id)).toEqual({ onHand: 3, reserved: 0, available: 3 }); // nothing reserved before approval

    // only the customer decides
    expect((await tech.post(`/repairs/quotations/${q.id}/decision`, { decision: 'APPROVE' })).status).toBe(403);
    const approve = await customer.post(`/repairs/quotations/${q.id}/decision`, { decision: 'APPROVE', comment: 'Go ahead' });
    expect(approve.status).toBe(200);
    expect(await stockOf(ssd.id)).toEqual({ onHand: 3, reserved: 1, available: 2 }); // reserved on approval

    let detail = (await tech.get(`/requests/${id}`)).body.data;
    expect(detail.status).toBe('APPROVED');
    expect(detail.parts).toHaveLength(1);
    expect(detail.parts[0].stockState).toBe('RESERVED');

    expect((await tech.post(`/requests/${id}/status`, { status: 'REPAIR_IN_PROGRESS' })).status).toBe(200);
    const install = await tech.post(`/repairs/${id}/parts/${detail.parts[0].id}/install`);
    expect(install.status).toBe(200);
    expect(await stockOf(ssd.id)).toEqual({ onHand: 2, reserved: 0, available: 2 }); // consumed once
    // installing twice never deducts twice
    expect((await tech.post(`/repairs/${id}/parts/${detail.parts[0].id}/install`)).status).toBe(409);
    expect(await stockOf(ssd.id)).toEqual({ onHand: 2, reserved: 0, available: 2 });
    const movements = await db('inventory_movements').where({ product_id: ssd.id, reference_type: 'REPAIR_PART' }).pluck('movement_type');
    expect(movements).toEqual(['RESERVATION', 'REPAIR_CONSUMPTION']);

    await tech.post(`/repairs/${id}/work-logs`, { activity: 'Installed SSD, cloned recovery image, Windows updates applied', minutesSpent: 90, visibleToCustomer: true });
    await tech.post(`/requests/${id}/status`, { status: 'TESTING_QC' });
    const report = await tech.put(`/repairs/${id}/report`, {
      originalProblem: 'Laptop does not boot', diagnosis: 'Failed SSD', actionsPerformed: 'Replaced SSD, reinstalled Windows 11, restored drivers',
      testingResults: 'Boots in 12 s, disk benchmark normal, 2-hour burn-in passed', recommendations: 'Back up regularly', warrantyDays: 90, outcome: 'RESOLVED',
    });
    expect(report.body.data.report.partsReplaced).toEqual([{ name: ssd.name, sku: ssd.sku, quantity: 1, chargeable: true }]);
    expect(report.body.data.warranty.endsOn).toBeTruthy();

    await tech.post(`/requests/${id}/status`, { status: 'AWAITING_PAYMENT' });
    // completion is blocked while the approved amount is unpaid
    expect((await tech.post(`/requests/${id}/status`, { status: 'COMPLETED' })).status).toBe(409);
    const pay = await finance.post('/payments/record', { payableType: 'SUPPORT_REQUEST', payableId: id, method: 'CASH', amountMinor: 10400, reference: `RCPT-${id}` });
    expect(pay.status).toBe(201);
    expect((await finance.post('/payments/record', { payableType: 'SUPPORT_REQUEST', payableId: id, method: 'CASH', amountMinor: 1, reference: `RCPT2-${id}` })).status).toBe(409); // nothing outstanding

    expect((await tech.post(`/requests/${id}/status`, { status: 'READY_FOR_COLLECTION' })).status).toBe(200);
    await tech.post(`/repairs/${id}/return`, { returnedTo: 'Test Customer' });
    const done = await tech.post(`/requests/${id}/status`, { status: 'COMPLETED' });
    expect(done.status).toBe(200);
    expect((await manager.post(`/requests/${id}/status`, { status: 'CLOSED' })).body.data.status).toBe('CLOSED');

    detail = (await customer.get(`/requests/${id}`)).body.data;
    expect(detail.balance).toEqual({ dueMinor: 10400, paidMinor: 10400, outstandingMinor: 0 });
    expect(detail.report.outcome).toBe('RESOLVED');
    // the device's repair history includes this job
    const history = await customer.get(`/account/devices/${detail.device.id}/history`);
    expect(history.body.data.map((h: { id: number }) => h.id)).toContain(id);
  });

  it('handles a revised quotation without reserving the same part twice, and releases removed parts', async () => {
    const store = await staff.store();
    const tech = await staff.tech2();
    const customer = await registerCustomer();
    const ssd = await createProduct(store, 5);
    const ram = await createProduct(store, 5);
    const { id } = await acceptedAndAssigned(customer, await laptopRequest(), tech.userId);
    await tech.put(`/repairs/${id}/intake`, { intakeType: 'WORKSHOP', conditionNotes: 'OK', customerAcknowledged: false });

    const q1 = (await tech.post(`/repairs/${id}/quotations`, { items: [
      { itemType: 'PART', description: 'SSD', productId: ssd.id, quantity: 1, unitPriceMinor: 5000 },
      { itemType: 'PART', description: 'RAM', productId: ram.id, quantity: 1, unitPriceMinor: 2000 },
    ] })).body.data.quotations[0];
    await customer.post(`/repairs/quotations/${q1.id}/decision`, { decision: 'APPROVE' });
    expect((await stockOf(ssd.id)).reserved).toBe(1);
    expect((await stockOf(ram.id)).reserved).toBe(1);
    await tech.post(`/requests/${id}/status`, { status: 'REPAIR_IN_PROGRESS' });

    // additional damage found: revised quotation keeps the SSD, drops the RAM, adds a 2nd SSD
    const revised = await tech.post(`/repairs/${id}/quotations`, { items: [
      { itemType: 'PART', description: 'SSD', productId: ssd.id, quantity: 2, unitPriceMinor: 5000 },
      { itemType: 'LABOUR', description: 'Extra labour', quantity: 1, unitPriceMinor: 1000 },
    ] });
    expect(revised.body.data.status).toBe('AWAITING_QUOTATION_APPROVAL');
    const q2 = revised.body.data.quotations[0];
    expect(q2.revision).toBe(2);
    // the first approval stays in force until the revision is decided
    expect((await stockOf(ssd.id)).reserved).toBe(1);

    await customer.post(`/repairs/quotations/${q2.id}/decision`, { decision: 'APPROVE' });
    expect(await stockOf(ssd.id)).toEqual({ onHand: 5, reserved: 2, available: 3 }); // 1 carried over + 1 new, not 3
    expect(await stockOf(ram.id)).toEqual({ onHand: 5, reserved: 0, available: 5 }); // released
    const detail = (await customer.get(`/requests/${id}`)).body.data;
    expect(detail.quotations.map((q: { status: string }) => q.status)).toEqual(['APPROVED', 'SUPERSEDED']);
    expect(detail.balance.dueMinor).toBe(11000);
  });

  it('waits for parts when stock is short and continues after a purchase order is received', async () => {
    const store = await staff.store();
    const tech = await staff.tech2();
    const customer = await registerCustomer();
    const part = await createProduct(store, 0);
    const { id } = await acceptedAndAssigned(customer, await laptopRequest(), tech.userId);
    await tech.put(`/repairs/${id}/intake`, { intakeType: 'WORKSHOP', conditionNotes: 'OK', customerAcknowledged: true });
    const q = (await tech.post(`/repairs/${id}/quotations`, { items: [{ itemType: 'PART', description: 'Part', productId: part.id, quantity: 1, unitPriceMinor: 900 }] })).body.data.quotations[0];
    await customer.post(`/repairs/quotations/${q.id}/decision`, { decision: 'APPROVE' });
    let detail = (await tech.get(`/requests/${id}`)).body.data;
    expect(detail.status).toBe('AWAITING_PARTS');
    expect(detail.parts[0]).toMatchObject({ stockState: 'NONE', awaitingStock: true });

    const supplier = (await db('suppliers').first('id')).id;
    const po = (await store.post('/inventory/purchase-orders', { supplierId: supplier, items: [{ productId: part.id, quantity: 4, unitCostMinor: 500 }] })).body.data;
    await store.post(`/inventory/purchase-orders/${po.id}/order`);
    const received = await store.post(`/inventory/purchase-orders/${po.id}/receive`, { items: [{ purchaseOrderItemId: po.items[0].id, quantityReceived: 4 }] });
    expect(received.body.data.status).toBe('RECEIVED');
    expect((await tech.get('/notifications')).body.data.items.some((n: { type: string }) => n.type === 'PARTS_ARRIVED')).toBe(true);

    const alloc = await tech.post(`/repairs/${id}/parts/allocate`);
    expect(alloc.body.data).toEqual({ waiting: 1, reserved: 1, stillWaiting: 0 });
    expect(await stockOf(part.id)).toEqual({ onHand: 4, reserved: 1, available: 3 });
    expect((await tech.post(`/requests/${id}/status`, { status: 'REPAIR_IN_PROGRESS' })).status).toBe(200);
    detail = (await tech.get(`/requests/${id}`)).body.data;
    await tech.post(`/repairs/${id}/parts/${detail.parts[0].id}/install`);
    expect(await stockOf(part.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });
  });

  it('releases reserved parts when a request is cancelled', async () => {
    const store = await staff.store();
    const tech = await staff.tech2();
    const customer = await registerCustomer();
    const part = await createProduct(store, 2);
    const { id, manager } = await acceptedAndAssigned(customer, await laptopRequest(), tech.userId);
    await tech.put(`/repairs/${id}/intake`, { intakeType: 'WORKSHOP', conditionNotes: 'OK', customerAcknowledged: true });
    const q = (await tech.post(`/repairs/${id}/quotations`, { items: [{ itemType: 'PART', description: 'Part', productId: part.id, quantity: 2, unitPriceMinor: 900 }] })).body.data.quotations[0];
    await customer.post(`/repairs/quotations/${q.id}/decision`, { decision: 'APPROVE' });
    expect((await stockOf(part.id)).reserved).toBe(2);
    expect((await manager.post(`/requests/${id}/status`, { status: 'CANCELLED' })).status).toBe(400); // reason required
    expect((await manager.post(`/requests/${id}/status`, { status: 'CANCELLED', note: 'Customer withdrew' })).status).toBe(200);
    expect(await stockOf(part.id)).toEqual({ onHand: 2, reserved: 0, available: 2 });
  });

  it('a declined quotation reserves nothing and returns the job to diagnosis', async () => {
    const store = await staff.store();
    const tech = await staff.tech2();
    const customer = await registerCustomer();
    const part = await createProduct(store, 2);
    const { id } = await acceptedAndAssigned(customer, await laptopRequest(), tech.userId);
    await tech.put(`/repairs/${id}/intake`, { intakeType: 'WORKSHOP', conditionNotes: 'OK', customerAcknowledged: true });
    const q = (await tech.post(`/repairs/${id}/quotations`, { items: [{ itemType: 'PART', description: 'Part', productId: part.id, quantity: 1, unitPriceMinor: 900 }] })).body.data.quotations[0];
    const declined = await customer.post(`/repairs/quotations/${q.id}/decision`, { decision: 'DECLINE', comment: 'Too expensive' });
    expect(declined.body.data.status).toBe('DECLINED');
    expect((await stockOf(part.id)).reserved).toBe(0);
    expect((await tech.get(`/requests/${id}`)).body.data.status).toBe('DIAGNOSIS_IN_PROGRESS');
    // a declined quotation can no longer be approved
    expect((await customer.post(`/repairs/quotations/${q.id}/decision`, { decision: 'APPROVE' })).status).toBe(409);
  });
});
