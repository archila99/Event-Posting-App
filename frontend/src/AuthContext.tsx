import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth, type User } from "./api";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - persisted so user does not need to re-auth every time

const SESSION_EXPIRES_KEY = "sessionExpiresAt";

/** Call after storing the token (e.g. on register). Keeps session limit in sync with backend. */
export function setSessionExpiry() {
  localStorage.setItem(SESSION_EXPIRES_KEY, String(Date.now() + SESSION_DURATION_MS));
}

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem(SESSION_EXPIRES_KEY);
}

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    const expiresAt = localStorage.getItem(SESSION_EXPIRES_KEY);
    if (expiresAt && Date.now() > Number(expiresAt)) {
      clearSession();
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await auth.me(signal);
      setUser(u);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = String((err as Error)?.message ?? "").toLowerCase();
      const isAuthError = msg.includes("unauthorized") || msg.includes("401");
      if (isAuthError) clearSession();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const initialRefreshDone = React.useRef(false);
  useEffect(() => {
    if (initialRefreshDone.current) return;
    initialRefreshDone.current = true;
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      logout();
    };
    window.addEventListener("auth-unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth-unauthorized", onUnauthorized);
  }, [logout]);

  // Log out when session time limit is reached (e.g. 20 min), even if idle
  useEffect(() => {
    const interval = setInterval(() => {
      const expiresAt = localStorage.getItem(SESSION_EXPIRES_KEY);
      if (expiresAt && Date.now() > Number(expiresAt)) {
        logout();
      }
    }, 30 * 1000); // check every 30 seconds
    return () => clearInterval(interval);
  }, [logout]);

  const login = async (email: string, password: string) => {
    const { user: u, token } = await auth.login(email, password);
    localStorage.setItem("token", token);
    setSessionExpiry();
    setUser(u);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
