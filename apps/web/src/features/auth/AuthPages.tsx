import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, User } from 'lucide-react';
import clsx from 'clsx';
import { acceptInviteSchema, forgotPasswordSchema, loginSchema, passwordSchema, registerSchema, type AuthTokens, type AuthUser } from '@dante/shared';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { Alert, Button, Checkbox, Input } from '../../components/ui';

function AuthCard({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex justify-center px-4 py-12 sm:py-16">
      <div className={clsx('card w-full p-6 sm:p-8', wide ? 'max-w-2xl' : 'max-w-md')}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const user = await login(v.email, v.password);
      navigate(safeNext(params.get('next'), user.accountType === 'STAFF' ? '/staff' : '/account'), { replace: true });
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <AuthCard title="Sign in" subtitle={<>New here? <Link to="/register" className="link">Create an account</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="E-mail address" type="email" autoComplete="email" error={form.formState.errors.email?.message} {...form.register('email')} />
        <Input label="Password" type="password" autoComplete="current-password" error={form.formState.errors.password?.message} {...form.register('password')} />
        <div className="flex justify-end"><Link to="/forgot-password" className="link text-sm">Forgot your password?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Sign in</Button>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register: registerAccount } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { accountType: params.get('type') === 'corporate' ? 'CORPORATE' : 'INDIVIDUAL' },
  });
  const type = form.watch('accountType');
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await registerAccount(v as z.output<typeof registerSchema>);
      navigate(safeNext(params.get('next'), '/account'), { replace: true });
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  return (
    <AuthCard wide title="Create your account" subtitle={<>Already registered? <Link to="/login" className="link">Sign in</Link></>}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <fieldset>
          <legend className="label">Account type</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['INDIVIDUAL', User, 'Individual', 'For yourself and your own devices'], ['CORPORATE', Building2, 'Organisation', 'For a company with several employees and devices']] as const).map(([v, Icon, label, desc]) => (
              <label key={v} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-4', type === v ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-100 hover:border-ink-600/30')}>
                <input type="radio" value={v} className="sr-only" {...form.register('accountType')} />
                <Icon className="mt-0.5 size-5 text-brand-700" aria-hidden />
                <span><span className="block font-semibold">{label}</span><span className="text-sm text-slate-500">{desc}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {type === 'CORPORATE' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Organisation name" required error={e.organizationName?.message} {...form.register('organizationName')} />
            <Input label="Registration number (optional)" error={e.organizationRegistrationNo?.message} {...form.register('organizationRegistrationNo')} />
            <Input label="Your department (optional)" error={e.department?.message} {...form.register('department')} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" required autoComplete="given-name" error={e.firstName?.message} {...form.register('firstName')} />
          <Input label="Last name" required autoComplete="family-name" error={e.lastName?.message} {...form.register('lastName')} />
          <Input label="E-mail address" required type="email" autoComplete="email" error={e.email?.message} {...form.register('email')} />
          <Input label="Telephone" required type="tel" autoComplete="tel" error={e.phone?.message} {...form.register('phone')} />
          <Input label="Password" required type="password" autoComplete="new-password" hint="At least 10 characters with a letter and a number" error={e.password?.message} {...form.register('password')} />
        </div>
        <div>
          <Checkbox label={<>I accept the <Link to="/legal/terms" target="_blank" className="link">terms of service</Link> and have read the <Link to="/legal/privacy" target="_blank" className="link">privacy notice</Link>.</>}
            {...form.register('acceptTerms')} />
          {e.acceptTerms && <p className="mt-1 text-xs font-medium text-rose-600">{e.acceptTerms.message}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>Create account</Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    await api('/auth/forgot-password', { body: v }).catch(() => undefined);
    setSent(true);
  });
  return (
    <AuthCard title="Reset your password" subtitle="We will e-mail you a link to choose a new password.">
      {sent ? (
        <Alert kind="success" title="Check your e-mail">If an account exists for that address, a reset link is on its way. The link is valid for one hour.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input label="E-mail address" type="email" autoComplete="email" error={form.formState.errors.email?.message} {...form.register('email')} />
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}

const newPasswordSchema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof newPasswordSchema>>({ resolver: zodResolver(newPasswordSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api('/auth/reset-password', { body: { token: params.get('token') ?? '', password: v.password } });
      navigate('/login', { replace: true });
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="New password" type="password" autoComplete="new-password" error={form.formState.errors.password?.message} {...form.register('password')} />
        <Input label="Repeat new password" type="password" autoComplete="new-password" error={form.formState.errors.confirm?.message} {...form.register('confirm')} />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Update password</Button>
      </form>
    </AuthCard>
  );
}

const inviteForm = acceptInviteSchema.omit({ token: true }).extend({ confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const { acceptSession } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof inviteForm>>({ resolver: zodResolver(inviteForm) });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const r = await api<{ user: AuthUser; tokens: AuthTokens }>('/auth/accept-invite', { body: { token: params.get('token') ?? '', password: v.password, phone: v.phone || undefined } });
      acceptSession(r.user, r.tokens);
      navigate(r.user.accountType === 'STAFF' ? '/staff' : '/account', { replace: true });
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <AuthCard title="Activate your account" subtitle="Set a password to finish setting up the account created for you.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="Telephone (optional)" type="tel" error={form.formState.errors.phone?.message} {...form.register('phone')} />
        <Input label="Password" type="password" autoComplete="new-password" hint="At least 10 characters with a letter and a number" error={form.formState.errors.password?.message} {...form.register('password')} />
        <Input label="Repeat password" type="password" autoComplete="new-password" error={form.formState.errors.confirm?.message} {...form.register('confirm')} />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Activate account</Button>
      </form>
    </AuthCard>
  );
}
