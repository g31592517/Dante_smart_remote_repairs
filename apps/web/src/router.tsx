import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AccountLayout, PublicLayout, RequireAuth, StaffLayout } from './components/layout';
import { HomePage } from './features/home/HomePage';
import { NotFoundPage } from './features/home/NotFoundPage';

const l = <T extends Record<string, React.ComponentType>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

// customer & public
const auth = () => import('./features/auth/AuthPages');
const LoginPage = l(auth, 'LoginPage');
const RegisterPage = l(auth, 'RegisterPage');
const ForgotPasswordPage = l(auth, 'ForgotPasswordPage');
const ResetPasswordPage = l(auth, 'ResetPasswordPage');
const AcceptInvitePage = l(auth, 'AcceptInvitePage');
const LegalPage = l(() => import('./features/home/LegalPage'), 'LegalPage');
const SupportPage = l(() => import('./features/home/SupportPage'), 'SupportPage');
const NewRequestPage = l(() => import('./features/support/NewRequestPage'), 'NewRequestPage');
const MyRequestsPage = l(() => import('./features/support/MyRequestsPage'), 'MyRequestsPage');
const CustomerRequestPage = l(() => import('./features/support/CustomerRequestPage'), 'CustomerRequestPage');
const shop = () => import('./features/store/ShopPages');
const ShopPage = l(shop, 'ShopPage');
const ProductPage = l(shop, 'ProductPage');
const cart = () => import('./features/store/CartPages');
const CartPage = l(cart, 'CartPage');
const CheckoutPage = l(cart, 'CheckoutPage');
const orders = () => import('./features/store/OrderPages');
const MyOrdersPage = l(orders, 'MyOrdersPage');
const OrderPage = l(orders, 'OrderPage');
const account = () => import('./features/account/AccountPages');
const OverviewPage = l(account, 'OverviewPage');
const DevicesPage = l(account, 'DevicesPage');
const OrganizationPage = l(account, 'OrganizationPage');
const ProfilePage = l(account, 'ProfilePage');
const MyPaymentsPage = l(account, 'MyPaymentsPage');
const NotificationsPage = l(account, 'NotificationsPage');

// staff
const staff = () => import('./features/staff/StaffPages');
const StaffDashboardPage = l(staff, 'StaffDashboardPage');
const RequestQueuePage = l(staff, 'RequestQueuePage');
const TechniciansPage = l(staff, 'TechniciansPage');
const StaffRequestPage = l(() => import('./features/staff/StaffRequestPage'), 'StaffRequestPage');
const store = () => import('./features/staff/StoreAdminPages');
const ProductsAdminPage = l(store, 'ProductsAdminPage');
const ProductEditPage = l(store, 'ProductEditPage');
const InventoryPage = l(store, 'InventoryPage');
const PurchasingPage = l(store, 'PurchasingPage');
const OrdersAdminPage = l(store, 'OrdersAdminPage');
const admin = () => import('./features/staff/AdminPages');
const PaymentsAdminPage = l(admin, 'PaymentsAdminPage');
const CustomersPage = l(admin, 'CustomersPage');
const CustomerDetailPage = l(admin, 'CustomerDetailPage');
const OrganizationsAdminPage = l(admin, 'OrganizationsAdminPage');
const TeamPage = l(admin, 'TeamPage');
const ReportsPage = l(admin, 'ReportsPage');
const AuditPage = l(admin, 'AuditPage');
const SettingsPage = l(admin, 'SettingsPage');

const customer = (el: React.ReactNode) => <RequireAuth kind="customer">{el}</RequireAuth>;

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'support', element: <SupportPage /> },
      { path: 'support/new', element: customer(<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6"><NewRequestPage /></div>) },
      { path: 'shop', element: <ShopPage /> },
      { path: 'shop/:slug', element: <ProductPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'checkout', element: customer(<CheckoutPage />) },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'accept-invite', element: <AcceptInvitePage /> },
      { path: 'legal/:doc', element: <LegalPage /> },
      {
        path: 'account',
        element: <RequireAuth kind="customer"><AccountLayout /></RequireAuth>,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'requests', element: <MyRequestsPage /> },
          { path: 'requests/:id', element: <CustomerRequestPage /> },
          { path: 'orders', element: <MyOrdersPage /> },
          { path: 'orders/:id', element: <OrderPage /> },
          { path: 'devices', element: <DevicesPage /> },
          { path: 'organization', element: <OrganizationPage /> },
          { path: 'payments', element: <MyPaymentsPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'profile', element: <ProfilePage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'staff',
    element: <RequireAuth kind="staff"><StaffLayout /></RequireAuth>,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <StaffDashboardPage /> },
      { path: 'requests', element: <RequestQueuePage /> },
      { path: 'requests/:id', element: <StaffRequestPage /> },
      { path: 'technicians', element: <TechniciansPage /> },
      { path: 'orders', element: <OrdersAdminPage /> },
      { path: 'orders/:id', element: <OrderPage /> },
      { path: 'products', element: <ProductsAdminPage /> },
      { path: 'products/new', element: <ProductEditPage /> },
      { path: 'products/:id', element: <ProductEditPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'purchasing', element: <PurchasingPage /> },
      { path: 'payments', element: <PaymentsAdminPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'organizations', element: <OrganizationsAdminPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <Navigate to="/staff" replace /> },
    ],
  },
]);
