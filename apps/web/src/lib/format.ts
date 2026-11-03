const dt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const d = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const fmtDateTime = (v?: string | null) => (v ? dt.format(new Date(v)) : '—');
export const fmtDate = (v?: string | null) => (v ? d.format(new Date(v.length === 10 ? `${v}T12:00:00` : v)) : '—');

export function timeAgo(v?: string | null) {
  if (!v) return '';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(v);
}

export const humanize = (v?: string | null) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : '');

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
