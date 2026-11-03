import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { SERVICE_TYPE_LABELS } from '@dante/shared';
import { apiPage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import type { RequestSummary } from '../../lib/types';
import { ButtonLink, Card, EmptyState, PageHeader, Pagination, QueryState, RequestStatusBadge } from '../../components/ui';

export function MyRequestsPage() {
  const { user } = useAuth();
  const [group, setGroup] = useState<'open' | 'closed' | 'all'>('open');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['requests', 'mine', group, page], queryFn: () => apiPage<RequestSummary>('/requests', { query: { statusGroup: group, page, pageSize: 15 } }) });
  const orgWide = user?.organization?.orgRole === 'ORG_ADMIN';
  return (
    <div>
      <PageHeader title={orgWide ? 'Organisation requests' : 'My requests'} subtitle={orgWide ? `All requests raised by ${user?.organization?.name} employees` : 'Your support and repair history'}
        actions={<ButtonLink to="/support/new" icon={<Plus className="size-4" />}>New request</ButtonLink>} />
      <div className="mb-4 flex gap-2" role="tablist">
        {(['open', 'closed', 'all'] as const).map((g) => (
          <button key={g} role="tab" aria-selected={group === g} onClick={() => { setGroup(g); setPage(1); }}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-medium ${group === g ? 'bg-ink-900 text-white' : 'bg-white text-slate-600'}`}>
            {{ open: 'Open', closed: 'Completed & closed', all: 'All' }[g]}
          </button>
        ))}
      </div>
      <Card padded={false}>
        <QueryState query={q}>
          {(d) => d.items.length === 0 ? (
            <EmptyState title="No requests here" action={<ButtonLink to="/support/new">Request ICT support</ButtonLink>}>When you report a problem it will appear here with its progress.</EmptyState>
          ) : (
            <>
              <ul className="divide-y divide-ink-100">
                {d.items.map((r) => (
                  <li key={r.id}>
                    <Link to={`/account/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-ink-50/70">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-900">{r.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {r.reference} · {SERVICE_TYPE_LABELS[r.serviceType]} · {fmtDate(r.submittedAt)}{orgWide ? ` · ${r.customerName}` : ''}{r.technicianName ? ` · ${r.technicianName}` : ''}
                        </p>
                      </div>
                      <RequestStatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
