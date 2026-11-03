import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import clsx from 'clsx';
import { CheckCircle2, MapPin, MessagesSquare, Paperclip, ScreenShare, Trash2, Wrench } from 'lucide-react';
import {
  createSupportRequestSchema, DEVICE_TYPE_LABELS, DEVICE_TYPES, SERVICE_TYPE_LABELS, URGENCY_LEVELS, type ServiceType,
} from '@dante/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';
import { fileSize, humanize } from '../../lib/format';
import type { Device, RequestDetail, ServiceCategory } from '../../lib/types';
import { Alert, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { uploadAttachments } from './attachments';

type FormIn = z.input<typeof createSupportRequestSchema>;
const STEPS = ['Type of help', 'Your problem', 'Device', 'Contact', 'Review'] as const;
const TYPE_ICONS: Record<ServiceType, typeof Wrench> = { REMOTE_SUPPORT: ScreenShare, HARDWARE_REPAIR: Wrench, ONSITE_SUPPORT: MapPin, CONSULTATION: MessagesSquare };
const TYPE_HELP: Record<ServiceType, string> = {
  REMOTE_SUPPORT: 'We connect to your computer over the internet (with your permission).',
  HARDWARE_REPAIR: 'Something is physically broken or does not power on.',
  ONSITE_SUPPORT: 'A technician visits your home or office.',
  CONSULTATION: 'Advice, or you are not sure.',
};

export function NewRequestPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RequestDetail | null>(null);
  const [deviceMode, setDeviceMode] = useState<'existing' | 'new' | 'none'>('none');

  const categories = useQuery({ queryKey: ['service-categories'], queryFn: () => api<ServiceCategory[]>('/settings/service-categories') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<Device[]>('/account/devices') });

  const form = useForm<FormIn>({
    resolver: zodResolver(createSupportRequestSchema),
    defaultValues: {
      serviceType: (params.get('type') as ServiceType) ?? 'REMOTE_SUPPORT',
      categoryId: params.get('category') ? Number(params.get('category')) : undefined,
      urgency: 'NORMAL',
      preferredContact: 'EMAIL',
    },
  });
  const { register, watch, setValue, formState: { errors }, trigger } = form;
  const serviceType = watch('serviceType') as ServiceType;

  useEffect(() => {
    if (!user) return;
    form.setValue('contactName', `${user.firstName} ${user.lastName}`);
    form.setValue('contactEmail', user.email);
    if (user.phone) form.setValue('contactPhone', user.phone);
  }, [user, form]);

  // a chosen category suggests the service type
  const categoryId = watch('categoryId');
  useEffect(() => {
    const c = categories.data?.find((x) => x.id === Number(categoryId));
    if (c?.defaultServiceType && !params.get('type')) setValue('serviceType', c.defaultServiceType);
  }, [categoryId, categories.data, setValue, params]);

  useEffect(() => {
    if (serviceType === 'HARDWARE_REPAIR' && deviceMode === 'none') setDeviceMode(devices.data?.length ? 'existing' : 'new');
  }, [serviceType, deviceMode, devices.data]);

  const stepFields: (keyof FormIn)[][] = [
    ['serviceType', 'categoryId'],
    ['title', 'description', 'errorMessages', 'urgency'],
    ['deviceId', 'device'],
    ['contactName', 'contactEmail', 'contactPhone', 'preferredContact', 'department', 'location', 'siteAddress', 'preferredVisitDate'],
    [],
  ];

  async function next() {
    if (step === 2) {
      if (deviceMode === 'none') { setValue('deviceId', undefined); setValue('device', undefined); }
      if (deviceMode === 'existing') setValue('device', undefined);
      if (deviceMode === 'new') setValue('deviceId', undefined);
      if (serviceType === 'HARDWARE_REPAIR' && deviceMode === 'none') {
        form.setError('device', { message: 'Hardware repairs need the device details' });
        return;
      }
    }
    if (await trigger(stepFields[step] as never)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await api<RequestDetail>('/requests', { body: values });
      if (files.length) await uploadAttachments(created.id, files, 'REQUEST');
      await qc.invalidateQueries({ queryKey: ['requests'] });
      setDone(created);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const msg = applyServerErrors(e, form.setError);
      setError(msg);
      const firstBad = stepFields.findIndex((fs) => fs.some((f) => form.getFieldState(f).error));
      if (firstBad >= 0) setStep(firstBad);
    }
  }, () => setError('Please check the highlighted fields.'));

  const category = useMemo(() => categories.data?.find((c) => c.id === Number(categoryId)), [categories.data, categoryId]);

  if (done) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 className="mx-auto size-12 text-brand-600" />
        <h1 className="mt-4 text-2xl font-semibold">Request received</h1>
        <p className="mt-2 text-slate-600">Your reference number is</p>
        <p className="mt-1 font-display text-3xl font-semibold tracking-wide text-ink-900">{done.reference}</p>
        <p className="mx-auto mt-4 max-w-md text-sm text-slate-600">We have sent a confirmation to {done.contact.email}. A support manager will review your request and assign a technician. You can follow every step on the request page.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => navigate(`/account/requests/${done.id}`)}>Open my request</Button>
          <Button variant="secondary" onClick={() => navigate('/account/requests')}>All my requests</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold sm:text-3xl">Request ICT support</h1>
      <p className="mt-1 text-sm text-slate-500">It takes about two minutes. Plain words are fine — we will ask if we need more detail.</p>

      <ol className="mt-6 grid grid-cols-5 gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-0">
            <div className={clsx('h-1.5 rounded-full', i <= step ? 'bg-brand-600' : 'bg-ink-100')} />
            <p className={clsx('mt-1.5 truncate text-xs font-medium', i === step ? 'text-ink-900' : 'text-slate-400')} aria-current={i === step ? 'step' : undefined}>{s}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => { e.preventDefault(); if (step === STEPS.length - 1) void submit(); else void next(); }} className="card mt-6 space-y-5 p-5 sm:p-7" noValidate>
        {error && <Alert kind="error">{error}</Alert>}

        {step === 0 && (
          <>
            <fieldset>
              <legend className="label">What kind of help do you need?</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => {
                  const Icon = TYPE_ICONS[t];
                  return (
                    <label key={t} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-4', serviceType === t ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-100 hover:border-ink-600/30')}>
                      <input type="radio" value={t} className="sr-only" {...register('serviceType')} />
                      <Icon className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
                      <span><span className="block font-semibold">{SERVICE_TYPE_LABELS[t]}</span><span className="text-sm text-slate-500">{TYPE_HELP[t]}</span></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <Select label="Which best describes the problem?" required placeholder="Choose a category" error={errors.categoryId?.message}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} {...register('categoryId', { valueAsNumber: true })} />
            {category?.description && <p className="-mt-3 text-xs text-slate-500">{category.description}</p>}
          </>
        )}

        {step === 1 && (
          <>
            <Input label="Short title" required placeholder="e.g. Outlook keeps asking for my password" error={errors.title?.message} {...register('title')} />
            <Textarea label="What is happening?" required rows={6} placeholder="When did it start? What were you doing? What have you already tried?" error={errors.description?.message} {...register('description')} />
            <Textarea label="Error messages (optional)" rows={3} placeholder="Copy any error text you see" error={errors.errorMessages?.message} {...register('errorMessages')} />
            <Select label="How urgent is it?" options={URGENCY_LEVELS.map((u) => ({ value: u, label: { LOW: 'Low — whenever possible', NORMAL: 'Normal', HIGH: 'High — affecting my work', CRITICAL: 'Critical — business stopped' }[u] }))} {...register('urgency')} />
            <Field label="Screenshots or documents (optional)" hint="Images, PDF, Word/Excel or .txt logs, up to 5 files">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-100 px-4 py-6 text-sm text-slate-500 hover:border-brand-500">
                <Paperclip className="size-4" /> Choose files
                <input type="file" multiple className="sr-only" accept="image/*,.pdf,.doc,.docx,.xlsx,.txt,.log"
                  onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5))} />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-1.5">
                      <span className="truncate">{f.name} <span className="text-slate-400">({fileSize(f.size)})</span></span>
                      <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Trash2 className="size-4 text-slate-500" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <fieldset>
              <legend className="label">Which device is affected?{serviceType === 'HARDWARE_REPAIR' && <span className="text-rose-500"> *</span>}</legend>
              <div className="flex flex-wrap gap-2">
                {(['existing', 'new', 'none'] as const).filter((m) => m !== 'existing' || devices.data?.length).map((m) => (
                  <button key={m} type="button" onClick={() => setDeviceMode(m)}
                    className={clsx('rounded-xl border px-3.5 py-2 text-sm font-medium', deviceMode === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-100')}>
                    {{ existing: 'One of my registered devices', new: 'A new device', none: 'Not device-specific' }[m]}
                  </button>
                ))}
              </div>
            </fieldset>
            {deviceMode === 'existing' && (
              <Select label="Device" placeholder="Choose a device" error={errors.deviceId?.message}
                options={(devices.data ?? []).map((d) => ({ value: d.id, label: `${DEVICE_TYPE_LABELS[d.deviceType as keyof typeof DEVICE_TYPE_LABELS]} — ${[d.manufacturer, d.model].filter(Boolean).join(' ') || 'unnamed'}${d.assetTag ? ` (${d.assetTag})` : ''}` }))}
                {...register('deviceId', { setValueAs: (v) => (v === '' || v === undefined ? undefined : Number(v)) })} />
            )}
            {deviceMode === 'new' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Device type" required options={DEVICE_TYPES.map((d) => ({ value: d, label: DEVICE_TYPE_LABELS[d] }))} {...register('device.deviceType')} />
                <Input label="Manufacturer" placeholder="e.g. HP, Dell, Lenovo" {...register('device.manufacturer')} />
                <Input label="Model" {...register('device.model')} />
                <Input label="Operating system" placeholder="e.g. Windows 11" {...register('device.operatingSystem')} />
                <Input label="Serial number (if known)" hint="Usually on a sticker underneath" {...register('device.serialNumber')} />
                {user?.organization && <Input label="Asset tag" {...register('device.assetTag')} />}
              </div>
            )}
            {errors.device?.message && <Alert kind="error">{errors.device.message}</Alert>}
          </>
        )}

        {step === 3 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Contact name" required error={errors.contactName?.message} {...register('contactName')} />
            <Input label="E-mail" required type="email" error={errors.contactEmail?.message} {...register('contactEmail')} />
            <Input label="Telephone" required type="tel" error={errors.contactPhone?.message} {...register('contactPhone')} />
            <Select label="Preferred contact method" options={['EMAIL', 'PHONE', 'WHATSAPP', 'IN_APP'].map((c) => ({ value: c, label: c === 'IN_APP' ? 'Messages on this website' : humanize(c) }))} {...register('preferredContact')} />
            {user?.organization && (
              <>
                <Input label="Department" error={errors.department?.message} {...register('department')} />
                <Input label="Office / location" error={errors.location?.message} {...register('location')} />
              </>
            )}
            {serviceType === 'ONSITE_SUPPORT' && (
              <>
                <div className="sm:col-span-2"><Textarea label="Where should we come?" required rows={2} error={errors.siteAddress?.message} {...register('siteAddress')} /></div>
                <Input label="Preferred visit date" type="date" min={new Date().toISOString().slice(0, 10)} {...register('preferredVisitDate', { setValueAs: (v) => v || undefined })} />
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-semibold">Check your request</h2>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[160px_1fr]">
              <dt className="text-slate-500">Service</dt><dd>{SERVICE_TYPE_LABELS[serviceType]}</dd>
              <dt className="text-slate-500">Category</dt><dd>{category?.name}</dd>
              <dt className="text-slate-500">Title</dt><dd>{watch('title')}</dd>
              <dt className="text-slate-500">Description</dt><dd className="whitespace-pre-line">{watch('description')}</dd>
              <dt className="text-slate-500">Urgency</dt><dd>{humanize(watch('urgency'))}</dd>
              <dt className="text-slate-500">Contact</dt><dd>{watch('contactName')} · {watch('contactEmail')} · {watch('contactPhone')}</dd>
              <dt className="text-slate-500">Attachments</dt><dd>{files.length ? files.map((f) => f.name).join(', ') : 'None'}</dd>
            </dl>
            {serviceType === 'REMOTE_SUPPORT' && <Alert kind="info">Once a technician is assigned, this request's page shows how to install AnyDesk and authorise the session. Nobody can connect without your permission.</Alert>}
          </div>
        )}

        <div className="flex justify-between gap-3 border-t border-ink-100 pt-5">
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < STEPS.length - 1 ? <Button type="submit">Continue</Button> : <Button type="submit" variant="accent" loading={form.formState.isSubmitting}>Submit request</Button>}
        </div>
      </form>
    </div>
  );
}
