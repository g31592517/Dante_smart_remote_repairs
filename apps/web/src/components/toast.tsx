import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}
const Ctx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-xl', t.kind === 'success' ? 'bg-ink-900' : 'bg-rose-600')}>
            {t.kind === 'success' ? <CheckCircle2 className="size-4 text-brand-400" /> : <AlertTriangle className="size-4" />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return { success: (t: string) => push('success', t), error: (t: string) => push('error', t) };
}
