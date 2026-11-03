import { useParams } from 'react-router';
import { useSettings } from '../../lib/settings';
import { Spinner } from '../../components/ui';

/** Terms and privacy texts are configured by the business in Admin → Settings (no legal claims are hard-coded). */
export function LegalPage() {
  const { doc } = useParams();
  const { data, isLoading } = useSettings();
  if (isLoading || !data) return <Spinner />;
  const terms = doc !== 'privacy';
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">{terms ? 'Terms of service' : 'Privacy notice'}</h1>
      {terms && <p className="mt-1 text-sm text-slate-500">Version {data.termsVersion}</p>}
      <div className="card mt-6 p-6 text-sm leading-relaxed whitespace-pre-line text-ink-800">{terms ? data.termsOfServiceText : data.privacyNoticeText}</div>
    </article>
  );
}
