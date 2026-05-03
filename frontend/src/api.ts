/** Backend origin only (no path). Strips trailing slashes and accidental `/api` suffix. */
function normalizeBackendBase(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (s.endsWith("/api")) s = s.slice(0, -4).replace(/\/+$/, "");
  return s;
}

const BASE_URL = normalizeBackendBase(import.meta.env.VITE_API_URL || "");
if (import.meta.env.PROD && !BASE_URL) {
  throw new Error("VITE_API_URL is required in production (must point to the backend base URL).");
}
const API = BASE_URL + "/api";

if (import.meta.env.DEV) {
  console.info("[api] Backend base:", BASE_URL || "(Vite proxy → same-origin /api)");
}

const NO_REFRESH_PATHS = new Set([
  "/auth/refresh",
  "/auth/login",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification-code",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/logout",
]);

let refreshInFlight: Promise<boolean> | null = null;

function getToken(): string | null {
  return localStorage.getItem("token");
}

/** Silent renewal via HttpOnly refresh cookie. Deduplicates concurrent refresh calls. */
export async function refreshAccessToken(signal?: AbortSignal): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.token) {
          localStorage.removeItem("token");
          return false;
        }
        localStorage.setItem("token", data.token);
        return true;
      } catch {
        localStorage.removeItem("token");
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export type Role = "ADMIN" | "ARTIST" | "USER";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerifiedAt?: string | null;
  createdAt?: string;
}

export async function api<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...options, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !NO_REFRESH_PATHS.has(path) && !isRetry) {
    const refreshed = await refreshAccessToken(options.signal as AbortSignal | undefined);
    if (refreshed) return api<T>(path, options, true);
  }

  if (res.status === 401) {
    localStorage.removeItem("token");
    window.dispatchEvent(new Event("auth-unauthorized"));
  }
  if (res.status === 403 && data?.code === "VERIFICATION_REQUIRED") {
    window.dispatchEvent(new CustomEvent("verification-required"));
  }
  if (!res.ok) {
    const err = data.error ?? data.message ?? res.statusText;
    const message = typeof err === "string" ? err : Array.isArray(err) ? err[0] : JSON.stringify(err);
    console.error(`API ${res.status} ${path}`, message, data);
    throw new Error(message || "Request failed");
  }
  return data as T;
}

export const auth = {
  register: (body: { email: string; password: string; name: string; role: Role }) =>
    api<{
      message: string;
      expiresInMinutes?: number;
      devCode?: string;
      emailError?: string;
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (email: string, password: string) =>
    api<{ user: User; token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: (signal?: AbortSignal) => api<User>("/auth/me", signal ? { signal } : {}),
  verifyEmail: (email: string, code: string) =>
    api<{ success: boolean; user: User | null; token: string }>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),
  resendVerificationCode: (email: string) =>
    api<{ message: string; expiresInMinutes?: number; devCode?: string }>("/auth/resend-verification-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  forgotPassword: (email: string) =>
    api<{ message: string; expiresInMinutes?: number }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    api<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, code, newPassword }),
    }),
  logout: () =>
    fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined),
};

export const locations = {
  list: (signal?: AbortSignal) =>
    api<Array<{ id: string; name: string; maxCapacity: number }>>("/locations", signal ? { signal } : {}),
  all: () => api<Array<{ id: string; name: string; maxCapacity: number; isActive: boolean }>>("/locations/all"),
  get: (id: string) => api<{ id: string; name: string; maxCapacity: number }>("/locations/" + id),
  create: (body: { name: string; maxCapacity: number }) =>
    api<{ id: string; name: string; maxCapacity: number }>("/locations", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: { name?: string; maxCapacity?: number; isActive?: boolean }) =>
    api("/locations/" + id, { method: "PATCH", body: JSON.stringify(body) }),
  deactivate: (id: string) => api("/locations/" + id, { method: "DELETE" }),
};

export const timeSlots = {
  list: (signal?: AbortSignal) =>
    api<Array<{ id: string; name: string; startTime: string; endTime: string }>>("/time-slots", signal ? { signal } : {}),
  all: () =>
    api<Array<{ id: string; name: string; startTime: string; endTime: string; isActive: boolean }>>("/time-slots/all"),
  get: (id: string) => api<{ id: string; name: string; startTime: string; endTime: string }>("/time-slots/" + id),
  create: (body: { name: string; startTime: string; endTime: string }) =>
    api("/time-slots", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: { name?: string; startTime?: string; endTime?: string; isActive?: boolean }) =>
    api("/time-slots/" + id, { method: "PATCH", body: JSON.stringify(body) }),
  deactivate: (id: string) => api("/time-slots/" + id, { method: "DELETE" }),
};

export interface EventItem {
  id: string;
  date: string;
  capacity: number;
  taken?: number;
  available?: number;
  status: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  artist: { id: string; name: string; email: string };
  location: { id: string; name: string; maxCapacity: number };
  timeSlot: { id: string; name: string; startTime: string; endTime: string };
}

export interface EventComment {
  id: string;
  eventId: string;
  userId: string;
  parentId?: string | null;
  content: string;
  createdAt: string;
  user: { id: string; name: string; role?: string };
}

export const events = {
  list: (params?: { status?: string; date?: string; fromDate?: string }, signal?: AbortSignal) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api<EventItem[]>("/events" + (q ? "?" + q : ""), signal ? { signal } : {});
  },
  get: (id: string, signal?: AbortSignal) =>
    api<EventItem & { taken: number; available: number }>("/events/" + id, signal ? { signal } : {}),
  create: (body: {
    locationId: string;
    date: string;
    timeSlotId: string;
    capacity: number;
    title?: string;
    description?: string;
    imageUrl?: string;
  }) => api<EventItem>("/events", { method: "POST", body: JSON.stringify(body) }),
  myEvents: (signal?: AbortSignal) => api<EventItem[]>("/events/my/requests", signal ? { signal } : {}),
};

export const comments = {
  list: (eventId: string, signal?: AbortSignal) =>
    api<EventComment[]>("/events/" + eventId + "/comments", signal ? { signal } : {}),
  create: (eventId: string, content: string, parentId?: string) =>
    api<EventComment>("/events/" + eventId + "/comments", {
      method: "POST",
      body: JSON.stringify({ content, ...(parentId ? { parentId } : {}) }),
    }),
  delete: (eventId: string, commentId: string) =>
    api<{ message: string }>("/events/" + eventId + "/comments/" + commentId, { method: "DELETE" }),
};

export const reservations = {
  my: (signal?: AbortSignal) =>
    api<
      Array<{
        id: string;
        quantity: number;
        status: string;
        expiresAt: string;
        event: EventItem & { taken: number; available: number };
      }>
    >("/reservations/my", signal ? { signal } : {}),
  create: (body: { eventId: string; quantity: number }) =>
    api<{ id: string; eventId: string; quantity: number; expiresAt: string }>("/reservations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  get: (id: string) =>
    api<{
      id: string;
      quantity: number;
      status: string;
      expiresAt: string;
      event: EventItem;
      tickets: Array<{ id: string; status: string }>;
    }>("/reservations/" + id),
};

export const tickets = {
  my: (signal?: AbortSignal) =>
    api<
      Array<{
        id: string;
        status: string;
        purchasedAt: string | null;
        event: EventItem;
      }>
    >("/tickets/my", signal ? { signal } : {}),
  sendVerificationCode: (reservationId: string) =>
    api<{ message: string; expiresInMinutes?: number; skipVerification?: boolean }>(
      "/tickets/send-verification-code/" + reservationId,
      { method: "POST" }
    ),
  purchase: (reservationId: string, code?: string) =>
    api<{ message: string; tickets: unknown[] }>("/tickets/purchase/" + reservationId, {
      method: "POST",
      body: JSON.stringify(code != null && code.length === 6 ? { code } : {}),
    }),
};

export const admin = {
  events: (signal?: AbortSignal) => api<EventItem[]>("/admin/events", signal ? { signal } : {}),
  cancelEvent: (id: string) => api<{ message: string }>("/admin/events/" + id + "/cancel", { method: "POST" }),
  overrideCapacity: (id: string, capacity: number) =>
    api<{ message: string; capacity: number }>("/admin/events/" + id + "/capacity", {
      method: "PATCH",
      body: JSON.stringify({ capacity }),
    }),
  reservations: (eventId?: string) =>
    api<unknown[]>("/admin/reservations" + (eventId ? "?eventId=" + eventId : "")),
  purchases: (eventId?: string) =>
    api<unknown[]>("/admin/purchases" + (eventId ? "?eventId=" + eventId : "")),
  refundTicket: (ticketId: string) =>
    api<{ message: string }>("/admin/tickets/" + ticketId + "/refund", { method: "POST" }),
  audit: (params?: { entityType?: string; entityId?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api<unknown[]>("/admin/audit" + (q ? "?" + q : ""));
  },
  deactivateUser: (id: string) =>
    api<{ message: string }>("/admin/users/" + id + "/deactivate", { method: "PATCH" }),
};

export const users = {
  list: () => api<User[]>("/users"),
};
