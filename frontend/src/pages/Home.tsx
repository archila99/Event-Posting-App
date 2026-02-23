import { useEffect, useState } from "react";
import { events } from "../api";
import { useAuth } from "../AuthContext";
import type { EventItem } from "../api";
import { EventPost } from "../components/events/EventPost";
import { Input } from "../components/ui/input";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const { user } = useAuth();
  const [list, setList] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setConnectionError(false);
    events
      .list({ status: "APPROVED", ...(dateFilter ? { fromDate: dateFilter } : {}) }, ac.signal)
      .then((data) => {
        setList(data);
        setConnectionError(false);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setList([]);
        const msg = String((err as Error)?.message ?? err).toLowerCase();
        setConnectionError(msg.includes("failed to fetch") || msg.includes("network") || (err as Error)?.name === "TypeError");
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [dateFilter]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">Browse upcoming concerts and view event details.</p>
        </div>
        <div className="w-full sm:w-[220px]">
          <label className="mb-2 block text-sm font-medium text-muted-foreground">Date</label>
          <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading events…</p>
      ) : connectionError ? (
        <div className="card max-w-lg">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Can’t reach the server.</span> Start the backend so the proxy can connect.
          </p>
          <pre className="mt-3 rounded-md border bg-background p-3 text-xs text-muted-foreground">npm run dev:backend</pre>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events found for this date.</p>
      ) : (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
          {list.map((e) => (
            <EventPost key={e.id} e={e} viewerRole={user?.role} />
          ))}
        </div>
      )}
    </>
  );
}
