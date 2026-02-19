// Concurrent load test: health, public endpoints, login, events, my reservations.
// Usage: k6 run -e BASE_URL=http://localhost:3001 k6/load.js
// Optional: -e LOGIN_EMAIL=user@ticketbook.com -e LOGIN_PASSWORD=password123

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const LOGIN_EMAIL = __ENV.LOGIN_EMAIL || "user@ticketbook.com";
const LOGIN_PASSWORD = __ENV.LOGIN_PASSWORD || "password123";

export const options = {
  scenarios: {
    load: {
      executor: "constant-vus",
      vus: 50,
      duration: "30s",
      startTime: "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.1"],
    http_req_duration: ["p(95)<5000"],
  },
};

function login() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  if (res.status !== 200) return null;
  const body = res.json();
  return body.token || null;
}

export default function () {
  // Public: health
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health ok": (r) => r.status === 200 });

  // Public: list events
  const eventsList = http.get(`${BASE_URL}/api/events`);
  check(eventsList, { "events listed": (r) => r.status === 200 && Array.isArray(r.json()) });

  sleep(0.3);

  // Auth: login
  const token = login();
  check(!!token, { "login ok": () => !!token });

  if (!token) {
    sleep(1);
    return;
  }

  const authHeader = { Authorization: `Bearer ${token}` };

  // Authenticated: list events again
  http.get(`${BASE_URL}/api/events`, { headers: authHeader });

  // Get first event id for detail (if any)
  const events = eventsList.json() || [];
  if (events.length > 0) {
    const firstId = events[0].id;
    const detail = http.get(`${BASE_URL}/api/events/${firstId}`, { headers: authHeader });
    check(detail, { "event detail ok": (r) => r.status === 200 });
  }

  // My reservations
  const myRes = http.get(`${BASE_URL}/api/reservations/my`, { headers: authHeader });
  check(myRes, { "my reservations ok": (r) => r.status === 200 && Array.isArray(r.json()) });

  sleep(0.5);
}
