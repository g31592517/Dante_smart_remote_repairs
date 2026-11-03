import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2, X } from 'lucide-react';
import { ORDER_STATUS_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_LABELS_STAFF, type OrderStatus, type RequestStatus } from '@dante/shared';
import { ApiError } from '../lib/api';

/* ---------------- buttons ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
const variants: Record<Variant, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-800 disabled:bg-ink-600/60',
  accent: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-500/50',
  secondary: 'bg-white text-ink-900 border border-ink-100 hover:border-ink-600/40 hover:bg-ink-50',
  ghost: 'text-ink-800 hover:bg-ink-100/70',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-400',
};
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed',
        { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-6 py-3.5 text-base' }[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ to, variant = 'primary', size = 'md', className, children, icon }: { to: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link to={to} className={clsx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
      { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-6 py-3.5 text-base' }[size], variants[variant], className)}>
      {icon}
      {children}
    </Link>
  );
}

/* ---------------- form fields ---------------- */

export function Field({ label, error, hint, children, required, htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-rose-500" aria-hidden> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: ReactNode };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, className, id, required, ...rest }, ref) {
  const autoId = useId();
  const input = <input ref={ref} id={id ?? autoId} aria-invalid={!!error} required={required} className={clsx('input', error && 'input-error', className)} {...rest} />;
  return label ? <Field label={label} error={error} hint={hint} required={required} htmlFor={id ?? autoId}>{input}</Field> : <Bare error={error}>{input}</Bare>;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string; hint?: ReactNode };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, hint, className, id, rows = 4, required, ...rest }, ref) {
  const autoId = useId();
  const el = <textarea ref={ref} id={id ?? autoId} rows={rows} aria-invalid={!!error} required={required} className={clsx('input', error && 'input-error', className)} {...rest} />;
  return label ? <Field label={label} error={error} hint={hint} required={required} htmlFor={id ?? autoId}>{el}</Field> : <Bare error={error}>{el}</Bare>;
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: ReactNode; options: { value: string | number; label: string }[]; placeholder?: string };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, hint, options, placeholder, className, id, required, ...rest }, ref) {
  const autoId = useId();
  const el = (
    <select ref={ref} id={id ?? autoId} aria-invalid={!!error} required={required} className={clsx('input pr-8', error && 'input-error', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label ? <Field label={label} error={error} hint={hint} required={required} htmlFor={id ?? autoId}>{el}</Field> : <Bare error={error}>{el}</Bare>;
});

/** Unlabelled control (labelled via aria-label): still shows its validation message. */
function Bare({ error, children }: { error?: string; children: ReactNode }) {
  if (!error) return <>{children}</>;
  return (
    <div>
      {children}
      <p role="alert" className="mt-1 text-xs font-medium text-rose-600">{error}</p>
    </div>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-800">
      <input type="checkbox" className="mt-0.5 size-4 rounded border-ink-100 accent-brand-600" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ---------------- surfaces & feedback ---------------- */

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          {title && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </section>
  );
}

const tone = {
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-sky-100 text-sky-800',
  teal: 'bg-brand-100 text-brand-700',
  amber: 'bg-spark-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-rose-100 text-rose-700',
  violet: 'bg-violet-100 text-violet-800',
} as const;
export type Tone = keyof typeof tone;
export function Badge({ children, color = 'slate', className }: { children: ReactNode; color?: Tone; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tone[color], className)}>{children}</span>;
}

const REQUEST_TONE: Record<RequestStatus, Tone> = {
  SUBMITTED: 'blue', UNDER_REVIEW: 'blue', ACCEPTED: 'teal', ASSIGNED: 'teal', AWAITING_CUSTOMER: 'amber', DIAGNOSIS_IN_PROGRESS: 'violet',
  AWAITING_QUOTATION_APPROVAL: 'amber', APPROVED: 'teal', AWAITING_PARTS: 'amber', REPAIR_IN_PROGRESS: 'violet', TESTING_QC: 'violet',
  AWAITING_PAYMENT: 'amber', READY_FOR_COLLECTION: 'green', COMPLETED: 'green', CLOSED: 'slate', CANCELLED: 'red',
};
export function RequestStatusBadge({ status, staff }: { status: RequestStatus; staff?: boolean }) {
  return <Badge color={REQUEST_TONE[status]}>{(staff ? REQUEST_STATUS_LABELS_STAFF : REQUEST_STATUS_LABELS)[status]}</Badge>;
}
const ORDER_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'amber', PAID: 'teal', PROCESSING: 'violet', READY_FOR_COLLECTION: 'green', OUT_FOR_DELIVERY: 'blue', COMPLETED: 'green', CANCELLED: 'red',
};
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge color={ORDER_TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-2xl bg-ink-100/70 p-3 text-ink-700">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ kind = 'info', title, children }: { kind?: 'info' | 'success' | 'warning' | 'error'; title?: ReactNode; children?: ReactNode }) {
  const styles = {
    info: ['border-sky-200 bg-sky-50 text-sky-900', Info],
    success: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2],
    warning: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle],
    error: ['border-rose-200 bg-rose-50 text-rose-900', AlertTriangle],
  } as const;
  const [cls, Icon] = styles[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Standard loading / error / content switch for queries. */
export function QueryState<T>({ query, children, empty }: { query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; children: (data: T) => ReactNode; empty?: ReactNode }) {
  if (query.isLoading) return <Spinner />;
  if (query.error) {
    const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403);
    return (
      <div className="p-4">
        <Alert kind="error" title={notFound ? 'Not available' : 'Could not load this page'}>
          {errorMessage(query.error)}{' '}
          {!notFound && <button className="link" onClick={() => query.refetch()}>Retry</button>}
        </Alert>
      </div>
    );
  }
  if (query.data === undefined) return null;
  if (empty && Array.isArray(query.data) && query.data.length === 0) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/* ---------------- dialog ---------------- */

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={clsx('m-auto w-[calc(100%-2rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-ink-950/50 backdrop:backdrop-blur-sm', wide ? 'max-w-3xl' : 'max-w-lg')}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-ink-100" aria-label="Close dialog"><X className="size-5" /></button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/* ---------------- layout helpers ---------------- */

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link to={back.to} className="mb-2 inline-block text-sm font-medium text-slate-500 hover:text-ink-900">← {back.label}</Link>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between border-t border-ink-100 px-5 py-3 text-sm" aria-label="Pagination">
      <span className="text-slate-500">Page {page} of {pages} · {total} total</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

export function Stat({ label, value, hint, tone: t = 'slate', to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: string }) {
  const inner = (
    <div className="card h-full p-4 transition-shadow hover:shadow-lg">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={clsx('mt-2 font-display text-2xl font-semibold', t === 'red' ? 'text-rose-600' : t === 'amber' ? 'text-amber-700' : t === 'teal' ? 'text-brand-700' : 'text-ink-900')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{i.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink-900">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-ink-100 bg-ink-50/60 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100">{children}</tbody>
      </table>
      {empty && <EmptyState title="Nothing here yet" />}
    </div>
  );
}
