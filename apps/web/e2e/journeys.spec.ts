import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'DemoPass123!';
const uid = () => Math.random().toString(36).slice(2, 8);

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(account|staff)/);
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test('Test 1 (UI): register → request remote support → manager assigns → technician connects with AnyDesk', async ({ browser }) => {
  // --- customer registers and submits a guided request
  const customer = await newPage(browser);
  const email = `e2e-${uid()}@example.com`;
  await customer.goto('/register');
  await customer.getByLabel('First name').fill('Erin');
  await customer.getByLabel('Last name').fill('Endtoend');
  await customer.getByLabel('E-mail address').fill(email);
  await customer.getByLabel('Telephone').fill('+254 700 111222');
  await customer.getByLabel('Password').fill('E2ePassword123');
  await customer.getByText('I accept the').click();
  await customer.getByRole('button', { name: 'Create account' }).click();
  await customer.waitForURL('**/account');

  await customer.getByRole('link', { name: 'Request support' }).first().click();
  await customer.getByText('Remote ICT support').first().click();
  await customer.getByLabel('Which best describes the problem?').selectOption({ label: 'Email configuration and access' });
  await customer.getByRole('button', { name: 'Continue' }).click();
  await customer.getByLabel('Short title').fill('Outlook keeps asking for my password');
  await customer.getByLabel('What is happening?').fill('Since this morning Outlook asks for my password every few minutes and no new mail arrives.');
  await customer.getByRole('button', { name: 'Continue' }).click();
  await customer.getByRole('button', { name: 'Continue' }).click(); // device: not device-specific
  await expect(customer.getByLabel('Contact name')).toHaveValue('Erin Endtoend');
  await customer.getByRole('button', { name: 'Continue' }).click();
  await customer.getByRole('button', { name: 'Submit request' }).click();
  await expect(customer.getByRole('heading', { name: 'Request received' })).toBeVisible();
  const reference = (await customer.locator('p.font-display').first().textContent())!.trim();
  expect(reference).toMatch(/^SR-\d{4}-\d{6}$/);
  await customer.getByRole('button', { name: 'Open my request' }).click();
  await expect(customer.getByText(reference)).toBeVisible();
  const requestUrl = customer.url();
  const requestId = requestUrl.split('/').pop()!;

  // --- support manager reviews and assigns
  const manager = await newPage(browser);
  await signIn(manager, 'manager@dante.local');
  await manager.goto(`/staff/requests/${requestId}`);
  await manager.getByRole('button', { name: 'Review request' }).click();
  await manager.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(manager.getByText('Accepted', { exact: true }).first()).toBeVisible();
  await manager.getByRole('button', { name: 'Assign technician' }).click();
  await manager.getByRole('dialog').getByText('Tom Technician').click();
  await manager.getByRole('dialog').getByRole('button', { name: 'Assign' }).click();
  await expect(manager.getByText('Technician assigned').first()).toBeVisible();

  // --- technician requests a remote session
  const tech = await newPage(browser);
  await signIn(tech, 'tech1@dante.local');
  await tech.goto(`/staff/requests/${requestId}`);
  await tech.getByPlaceholder('Instructions for the customer (optional)').fill('Please keep your computer on and logged in.');
  await tech.getByRole('button', { name: 'Request remote session' }).click();
  await expect(tech.getByText('Waiting for the customer to enter their AnyDesk ID')).toBeVisible();

  // --- customer reloads (session restored from the httpOnly cookie) and authorises
  await customer.reload();
  await expect(customer.getByRole('heading', { name: 'Remote support session' })).toBeVisible();
  await expect(customer.getByRole('link', { name: 'Download AnyDesk' })).toHaveAttribute('href', 'https://anydesk.com/en/downloads');
  const authorise = customer.getByRole('button', { name: 'Authorise remote session' });
  await customer.getByLabel('AnyDesk ID').fill('my-password!');
  await expect(customer.getByText('That does not look like an AnyDesk ID')).toBeVisible();
  await customer.getByLabel('AnyDesk ID').fill('123 456 789');
  await expect(authorise).toBeDisabled(); // consent not yet given
  await customer.getByText('I have read this and I authorise').click();
  await authorise.click();
  await expect(customer.getByText('Authorised — waiting for your technician to connect.')).toBeVisible();

  // --- technician sees the AnyDesk ID and launches the documented URL handler
  await tech.reload();
  await expect(tech.getByText('123456789')).toBeVisible();
  const launch = tech.waitForEvent('requestfailed', { predicate: (r) => r.url().startsWith('anydesk:'), timeout: 5000 }).catch(() => null);
  await tech.getByRole('button', { name: 'Connect using AnyDesk' }).click();
  expect(await launch, 'the browser was sent to the anydesk: URL handler').not.toBeNull();
  // Headless Chromium stops delivering input to a tab that has a pending external-protocol prompt
  // (a real browser shows "Open AnyDesk?"), so the technician carries on in a fresh tab.
  const tech2 = await tech.context().newPage();
  await tech2.goto(`/staff/requests/${requestId}`);
  await expect(tech2.getByRole('link', { name: 'open AnyDesk again' })).toHaveAttribute('href', 'anydesk:123456789');
  await tech2.getByRole('button', { name: 'Customer accepted — mark active' }).click();
  await expect(tech2.getByText('Session in progress').or(tech2.getByRole('button', { name: 'Complete session' }))).toBeVisible();
  await tech2.getByRole('button', { name: 'Complete session' }).click();
  await tech2.getByRole('dialog').getByLabel('Work performed').fill('Rebuilt the Outlook profile and re-authenticated the mailbox.');
  await tech2.getByRole('dialog').getByRole('button', { name: 'Complete' }).click();
  await expect(tech2.getByText('Previous sessions (1)')).toBeVisible();

  // --- customer sees the progress on the timeline
  await customer.reload();
  await expect(customer.getByText('Remote session completed (resolved)')).toBeVisible();
});

test('Test 3 (UI): browse, add to cart and check out for collection', async ({ page }) => {
  await signIn(page, 'jane@example.com');
  await page.goto('/shop');
  await page.getByLabel('Search products').fill('NVMe');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: /512GB NVMe/ }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart')).toBeVisible();
  await page.goto('/cart');
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: /Collect from our office/ }).click();
  await page.getByText('Cash', { exact: true }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order placed')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Order ORD-\d{4}-\d{6}/ })).toBeVisible();
  await expect(page.getByText('Awaiting payment').first()).toBeVisible();
});

test('Test 6 (UI): customers are kept out of the staff portal; staff menus follow permissions', async ({ browser }) => {
  const customer = await newPage(browser);
  await signIn(customer, 'jane@example.com');
  await customer.goto('/staff');
  await expect(customer).toHaveURL(/\/account$/);

  const tech = await newPage(browser);
  await signIn(tech, 'tech1@dante.local');
  const nav = tech.getByRole('navigation', { name: 'Staff' });
  await expect(nav.getByRole('link', { name: 'Service requests' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Payments' })).toHaveCount(0);

  const store = await newPage(browser);
  await signIn(store, 'store@dante.local');
  const storeNav = store.getByRole('navigation', { name: 'Staff' });
  await expect(storeNav.getByRole('link', { name: 'Inventory' })).toBeVisible();
  await expect(storeNav.getByRole('link', { name: 'Service requests' })).toHaveCount(0);
});

test('responsive: no horizontal scrolling on a phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  for (const path of ['/', '/shop', '/support', '/login', '/register']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
