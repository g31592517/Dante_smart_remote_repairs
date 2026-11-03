import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ButtonLink } from '../../components/ui';

export function NotFoundPage() {
  const err = useRouteError();
  const notFound = !err || (isRouteErrorResponse(err) && err.status === 404);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="font-display text-6xl font-semibold text-brand-500/40">{notFound ? '404' : 'Oops'}</p>
      <h1 className="mt-4 text-2xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="mt-2 text-slate-600">{notFound ? 'The page you were looking for does not exist or has moved.' : 'Please reload the page. If the problem continues, contact us.'}</p>
      <div className="mt-6 flex gap-3">
        <ButtonLink to="/">Go home</ButtonLink>
        <ButtonLink to="/support/new" variant="secondary">Request support</ButtonLink>
      </div>
    </div>
  );
}
