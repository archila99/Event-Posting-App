import { useEffect, useState } from "react";
import { tickets } from "../api";

type TicketItem = Awaited<ReturnType<typeof tickets.my>>[number];

export default function MyTickets() {
  const [list, setList] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    tickets
      .my(ac.signal)
      .then(setList)
      .catch((err) => {
        if ((err as { name?: string })?.name !== "AbortError") setList([]);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>My tickets</h1>
        <p>Your purchased tickets</p>
      </div>
      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No purchased tickets yet.</p>
      ) : (
        <div className="grid">
          {list.map((t) => (
            <div key={t.id} className="card">
              <h3 className="mb-2 font-semibold">{t.event.title || "Concert"}</h3>
              <p className="text-sm text-muted-foreground">
                {t.event.location.name} · {t.event.date} · {t.event.timeSlot.name} ({t.event.timeSlot.startTime}–{t.event.timeSlot.endTime})
              </p>
              <p className="mt-1.5 text-sm">
                Purchased {t.purchasedAt ? new Date(t.purchasedAt).toLocaleString() : "—"}
              </p>
              <span className="badge badge-sold">SOLD</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
