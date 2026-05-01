import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth, refreshAccessToken, type User } from "./api";

function clearAccessToken() {
  localStorage.removeItem("token");
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
    void auth.logout();
    clearAccessToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      let token = localStorage.getItem("token");
      if (!token) {
        const renewed = await refreshAccessToken(signal);
        if (!renewed) {
          setUser(null);
          return;
        }
        token = localStorage.getItem("token");
      }
      if (!token) {
        setUser(null);
        return;
      }
      try {
        const u = await auth.me(signal);
        setUser(u);
      } catch {
        const ok = await refreshAccessToken(signal);
        if (ok) {
          const u = await auth.me(signal);
          setUser(u);
        } else {
          setUser(null);
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
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

  const login = async (email: string, password: string) => {
    const { user: u, token } = await auth.login(email, password);
    localStorage.setItem("token", token);
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
