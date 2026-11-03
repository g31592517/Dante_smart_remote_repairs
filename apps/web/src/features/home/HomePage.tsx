import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ArrowRight, Building2, Download, Gauge, HelpCircle, KeyRound, Mail, Monitor, MonitorSmartphone, Printer, ShieldCheck, Settings, Truck,
  Users, Wifi, Wrench, CheckCircle2, ScreenShare,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { Product, ServiceCategory } from '../../lib/types';
import { useSettings } from '../../lib/settings';
import { ButtonLink } from '../../components/ui';
import { ProductCard } from '../store/ProductCard';

export const CATEGORY_ICONS: Record<string, typeof Mail> = {
  mail: Mail, download: Download, monitor: Monitor, gauge: Gauge, wifi: Wifi, printer: Printer, users: Users, settings: Settings,
  shield: ShieldCheck, wrench: Wrench, help: HelpCircle,
};

export function HomePage() {
  const { data: settings } = useSettings();
  const categories = useQuery({ queryKey: ['service-categories'], queryFn: () => api<ServiceCategory[]>('/settings/service-categories') });
  const featured = useQuery({ queryKey: ['products', 'featured'], queryFn: () => api<Product[]>('/catalog/products', { query: { featured: 'true', pageSize: 4 } }) });

  return (
    <>
      {/* hero */}
      <section className="relative overflow-hidden bg-ink-900 text-white">
        <div aria-hidden className="absolute inset-0 opacity-40 [background:radial-gradient(60rem_30rem_at_85%_-10%,#14b8a6_0%,transparent_60%),radial-gradient(40rem_20rem_at_0%_120%,#f5a524_0%,transparent_55%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wide text-brand-400 uppercase">
              <ScreenShare className="size-3.5" /> Help without leaving your desk
            </p>
            <h1 className="mt-5 text-4xl leading-[1.1] font-semibold sm:text-5xl">
              ICT support that comes to you — <span className="text-brand-400">remotely</span>, on-site or at our workshop.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-100/80">
              Report a computer, e-mail, network or printer problem in a few clicks, follow every step of the repair, and buy the parts and equipment you need — all in one place, for individuals and businesses.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/support/new" variant="accent" size="lg" icon={<Wrench className="size-5" />}>Request ICT support</ButtonLink>
              <ButtonLink to="/shop" variant="secondary" size="lg" icon={<MonitorSmartphone className="size-5" />}>Browse IT products</ButtonLink>
            </div>
            <ul className="mt-8 grid max-w-xl gap-2 text-sm text-ink-100/80 sm:grid-cols-2">
              {['Track your request in real time', 'No chargeable work without your approval', 'Remote sessions only with your consent', 'Corporate accounts for whole teams'].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-brand-400" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="grid content-center gap-4">
            <ServiceTile icon={ScreenShare} title="Remote ICT support" text="E-mail, software, Windows and configuration problems solved over a secure AnyDesk session that you authorise." to="/support/new?type=REMOTE_SUPPORT" />
            <ServiceTile icon={Wrench} title="Hardware repair" text="Laptops, desktops, printers, servers and network devices — diagnosed, quoted and repaired with full progress tracking." to="/support/new?type=HARDWARE_REPAIR" />
            <ServiceTile icon={Truck} title="IT products & spare parts" text="SSDs, RAM, chargers, monitors, networking and more — from the same stock our technicians use." to="/shop" />
          </div>
        </div>
      </section>

      {/* categories */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold">What can we help with?</h2>
            <p className="mt-2 text-slate-600">Pick the closest match — our team re-routes it if needed.</p>
          </div>
          <Link to="/support/new" className="link inline-flex items-center gap-1">Start a request <ArrowRight className="size-4" /></Link>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(categories.data ?? []).map((c) => {
            const Icon = CATEGORY_ICONS[c.icon ?? ''] ?? HelpCircle;
            return (
              <Link key={c.id} to={`/support/new?category=${c.id}`} className="card group flex gap-3 p-4 transition-shadow hover:shadow-lg">
                <span className="h-fit rounded-xl bg-brand-50 p-2.5 text-brand-700 group-hover:bg-brand-100"><Icon className="size-5" aria-hidden /></span>
                <span>
                  <span className="block font-semibold">{c.name}</span>
                  <span className="mt-0.5 block text-sm text-slate-500">{c.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* how remote support works */}
      <section id="how-it-works" className="scroll-mt-20 bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="text-3xl font-semibold">How remote support works</h2>
          <p className="mt-2 max-w-2xl text-slate-600">Most software problems are fixed without anyone travelling. You stay in control the whole time.</p>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {[
              { t: 'Tell us the problem', d: 'Describe what is happening and attach screenshots. You get a reference number immediately.' },
              { t: 'We assign a technician', d: 'A support manager reviews your request and assigns the right technician.' },
              { t: 'Install AnyDesk & authorise', d: `Download AnyDesk from the official site, share the AnyDesk ID it shows (never a password) and confirm on your request page.` },
              { t: 'Watch it get fixed', d: 'Accept the connection in AnyDesk, watch the work live, and receive a written report when done.' },
            ].map((s, i) => (
              <li key={s.t} className="relative rounded-2xl border border-ink-100 p-5">
                <span className="font-display text-4xl font-semibold text-brand-500/40">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-2 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-600">
            <KeyRound className="size-4 text-brand-700" /> You can end a session at any moment by closing AnyDesk or withdrawing your authorisation.
            {settings && <a className="link" href={settings.anydeskDownloadUrl} target="_blank" rel="noreferrer">Get AnyDesk</a>}
          </p>
        </div>
      </section>

      {/* featured products */}
      {!!featured.data?.length && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold">Featured products</h2>
              <p className="mt-2 text-slate-600">Tested parts and equipment, in stock now.</p>
            </div>
            <Link to="/shop" className="link inline-flex items-center gap-1">Visit the shop <ArrowRight className="size-4" /></Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{featured.data.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </section>
      )}

      {/* businesses */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-8 rounded-3xl bg-gradient-to-br from-brand-600 to-ink-800 p-8 text-white sm:p-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <Building2 className="size-8 text-spark-500" />
            <h2 className="mt-4 text-3xl font-semibold">ICT support for your whole organisation</h2>
            <p className="mt-3 text-white/80">Register your company once, invite employees, keep an inventory of devices per department, and see every request and repair across the organisation with centralised billing.</p>
          </div>
          <div className="flex flex-col justify-center gap-3">
            <ButtonLink to="/register?type=corporate" variant="secondary" size="lg">Open a corporate account</ButtonLink>
            <p className="text-center text-sm text-white/70">Already registered? <Link className="font-semibold underline" to="/login">Sign in</Link></p>
          </div>
        </div>
      </section>
    </>
  );
}

function ServiceTile({ icon: Icon, title, text, to }: { icon: typeof Mail; title: string; text: string; to: string }) {
  return (
    <Link to={to} className="group flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur transition-colors hover:bg-white/10">
      <span className="h-fit rounded-xl bg-brand-500/20 p-3 text-brand-400"><Icon className="size-6" aria-hidden /></span>
      <span>
        <span className="flex items-center gap-1 font-display text-lg font-semibold">{title} <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" /></span>
        <span className="mt-1 block text-sm text-ink-100/75">{text}</span>
      </span>
    </Link>
  );
}
