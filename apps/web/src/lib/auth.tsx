import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthTokens, AuthUser, PermissionCode, RegisterInput } from '@dante/shared';
import { api, onAuthChange, refreshSession, setAccessToken } from './api';

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login(email: string, password: string): Promise<AuthUser>;
  register(input: RegisterInput): Promise<AuthUser>;
  acceptSession(user: AuthUser, tokens: AuthTokens): void;
  logout(): Promise<void>;
  reload(): Promise<void>;
  can(...perms: PermissionCode[]): boolean;
  isStaff: boolean;
  isCustomer: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    onAuthChange(setUser);
    // restore the session from the httpOnly refresh cookie (if any)
    void refreshSession().finally(() => setReady(true));
  }, []);

  const acceptSession = useCallback((u: AuthUser, tokens: AuthTokens) => {
    setAccessToken(tokens.accessToken);
    setUser(u);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: AuthUser; tokens: AuthTokens }>('/auth/login', { body: { email, password } });
    acceptSession(r.user, r.tokens);
    return r.user;
  }, [acceptSession]);

  const register = useCallback(async (input: RegisterInput) => {
    const r = await api<{ user: AuthUser; tokens: AuthTokens }>('/auth/register', { body: input });
    acceptSession(r.user, r.tokens);
    return r.user;
  }, [acceptSession]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { body: {} }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const reload = useCallback(async () => {
    setUser(await api<AuthUser>('/auth/me'));
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    ready,
    login,
    register,
    acceptSession,
    logout,
    reload,
    can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
    isStaff: !!user && user.accountType === 'STAFF',
    isCustomer: !!user && user.roles.includes('CUSTOMER'),
  }), [user, ready, login, register, acceptSession, logout, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
