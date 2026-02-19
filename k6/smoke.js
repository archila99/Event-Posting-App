// Light smoke test: health + public API. No auth.
// Usage: k6 run -e BASE_URL=http://localhost:3001 k6/smoke.js

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

export const options = {
  vus: 20,
  duration: "10s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000"],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, { "health ok": (r) => r.status === 200 && r.json("ok") === true });

  const events = http.get(`${BASE_URL}/api/events`);
  check(events, { "events listed": (r) => r.status === 200 && Array.isArray(r.json()) });

  const locations = http.get(`${BASE_URL}/api/locations`);
  check(locations, { "locations listed": (r) => r.status === 200 && Array.isArray(r.json()) });

  sleep(0.5);
}
