import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { HelpCircle, ScreenShare, Wrench, MapPin, MessagesSquare } from 'lucide-react';
import { SERVICE_TYPE_LABELS, type ServiceType } from '@dante/shared';
import { api } from '../../lib/api';
import type { ServiceCategory } from '../../lib/types';
import { ButtonLink, PageHeader } from '../../components/ui';
import { CATEGORY_ICONS } from './HomePage';

const TYPES: { type: ServiceType; icon: typeof Wrench; text: string }[] = [
  { type: 'REMOTE_SUPPORT', icon: ScreenShare, text: 'A technician connects to your computer with AnyDesk after you authorise it. Ideal for e-mail, software, Windows and configuration problems.' },
  { type: 'HARDWARE_REPAIR', icon: Wrench, text: 'Bring the device to our workshop (or we collect it). We diagnose it, send you a quotation, and repair it once you approve.' },
  { type: 'ONSITE_SUPPORT', icon: MapPin, text: 'A technician visits your home or office — networks, printers, cabling and multi-device problems.' },
  { type: 'CONSULTATION', icon: MessagesSquare, text: 'Advice on equipment, security, backups or anything else ICT-related.' },
];

export function SupportPage() {
  const categories = useQuery({ queryKey: ['service-categories'], queryFn: () => api<ServiceCategory[]>('/settings/service-categories') });
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="ICT support & repairs" subtitle="Choose how you would like to be helped. You can follow every step from your account." actions={<ButtonLink to="/support/new" variant="accent">Request support</ButtonLink>} />
      <div className="grid gap-4 md:grid-cols-2">
        {TYPES.map((t) => (
          <Link key={t.type} to={`/support/new?type=${t.type}`} className="card flex gap-4 p-5 transition-shadow hover:shadow-lg">
            <span className="h-fit rounded-xl bg-ink-900 p-3 text-brand-400"><t.icon className="size-6" aria-hidden /></span>
            <span>
              <span className="block font-display text-lg font-semibold">{SERVICE_TYPE_LABELS[t.type]}</span>
              <span className="mt-1 block text-sm text-slate-600">{t.text}</span>
            </span>
          </Link>
        ))}
      </div>
      <h2 className="mt-12 text-2xl font-semibold">Common problems</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(categories.data ?? []).map((c) => {
          const Icon = CATEGORY_ICONS[c.icon ?? ''] ?? HelpCircle;
          return (
            <li key={c.id}>
              <Link to={`/support/new?category=${c.id}`} className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 text-sm font-medium hover:border-brand-500">
                <Icon className="size-4 text-brand-700" aria-hidden /> {c.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
