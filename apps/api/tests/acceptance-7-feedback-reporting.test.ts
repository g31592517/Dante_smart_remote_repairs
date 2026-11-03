import { describe, expect, it } from 'vitest';
import { acceptedAndAssigned, categoryId, registerCustomer, staff, supportRequestBody } from './helpers.js';
import { toCsv } from '../src/modules/reports/csv.js';

/** ACCEPTANCE TEST 7 — Final report, customer feedback and performance reporting. */
describe('Acceptance 7: feedback and reporting', () => {
  it('completed job → report → feedback → visible in satisfaction and technician performance reports', async () => {
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const manager = await staff.manager();
    const { id, reference } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Computer performance') }), tech.userId);
    await tech.post(`/requests/${id}/status`, { status: 'DIAGNOSIS_IN_PROGRESS' });

    // feedback is only possible after completion
    expect((await customer.post(`/repairs/${id}/feedback`, { rating: 5, issueResolved: true })).status).toBe(409);

    await tech.post(`/repairs/${id}/work-logs`, { activity: 'Removed start-up bloat and updated drivers', minutesSpent: 45 });
    await tech.put(`/repairs/${id}/report`, {
      originalProblem: 'Slow computer', diagnosis: '40 start-up programs, outdated storage driver', actionsPerformed: 'Disabled start-up items, updated drivers',
      testingResults: 'Boot time 95 s → 28 s', recommendations: 'Consider an SSD upgrade', outcome: 'RESOLVED',
    });
    await tech.post(`/requests/${id}/status`, { status: 'COMPLETED' });

    const fb = await customer.post(`/repairs/${id}/feedback`, {
      rating: 4, issueResolved: true, timelinessRating: 5, communicationRating: 4, professionalismRating: 5, comment: 'Much faster now, thank you!',
    });
    expect(fb.status).toBe(201);
    expect(fb.body.data.feedback.rating).toBe(4);
    expect((await customer.post(`/repairs/${id}/feedback`, { rating: 1, issueResolved: false })).status).toBe(409); // once only
    expect((await tech.post(`/repairs/${id}/feedback`, { rating: 5, issueResolved: true })).status).toBe(403);

    // the report is part of the customer's history
    const history = (await customer.get('/requests?statusGroup=closed')).body.data;
    expect(history.map((r: { id: number }) => r.id)).toContain(id);

    // administrators see satisfaction and technician performance
    const sat = (await manager.get('/reports/satisfaction')).body.data.data;
    expect(sat.responses).toBeGreaterThanOrEqual(1);
    expect(sat.recentComments.some((c: { reference: string }) => c.reference === reference)).toBe(true);
    const perf = (await manager.get('/reports/technician-performance')).body.data.data;
    const mine = perf.find((t: { technicianId: number }) => t.technicianId === tech.userId);
    expect(mine.completed).toBeGreaterThanOrEqual(1);
    expect(mine.avgRating).not.toBeNull();
    expect(mine.minutesLogged).toBeGreaterThanOrEqual(45);

    const times = (await manager.get('/reports/response-times')).body.data.data;
    const remote = times.find((t: { serviceType: string }) => t.serviceType === 'REMOTE_SUPPORT');
    expect(remote.avgResponseMinutes).not.toBeNull();

    const byCat = (await manager.get('/reports/requests-by-category')).body.data.data;
    expect(byCat.find((c: { category: string }) => c.category.startsWith('Computer performance')).completed).toBeGreaterThanOrEqual(1);

    // CSV export
    const csv = await manager.get('/reports/requests-by-category?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('category,total,completed,cancelled');

    const dash = (await manager.get('/reports/dashboard')).body.data;
    expect(dash.support.completedThisMonth).toBeGreaterThanOrEqual(1);
    expect(dash.finance).toBeDefined(); // support managers monitor payments
    // a technician's dashboard shows only their own jobs — no business-wide or financial figures
    const techDash = (await tech.get('/reports/dashboard')).body.data;
    expect(techDash.finance).toBeUndefined();
    expect(techDash.support).toBeUndefined();
    expect(techDash.myJobs).toBeDefined();

    // low ratings alert managers
    const unhappy = await registerCustomer();
    const job2 = await acceptedAndAssigned(unhappy, supportRequestBody({ categoryId: await categoryId('Computer performance') }), tech.userId);
    await tech.post(`/requests/${job2.id}/status`, { status: 'DIAGNOSIS_IN_PROGRESS' });
    await tech.put(`/repairs/${job2.id}/report`, { originalProblem: 'x', diagnosis: 'x', actionsPerformed: 'x', testingResults: 'x', outcome: 'PARTIALLY_RESOLVED' });
    await tech.post(`/requests/${job2.id}/status`, { status: 'COMPLETED' });
    await unhappy.post(`/repairs/${job2.id}/feedback`, { rating: 2, issueResolved: false, comment: 'Still slow' });
    expect((await manager.get('/notifications')).body.data.items.some((n: { type: string; title: string }) => n.type === 'LOW_FEEDBACK' && n.title.includes(job2.reference))).toBe(true);
  });

  it('CSV export neutralises spreadsheet formulas', () => {
    const csv = toCsv([{ a: '=HYPERLINK("http://evil")', b: '-5', c: 'x,"y"' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(',-5,'); // negative numbers untouched
    expect(csv).toContain('"x,""y"""');
  });
});
