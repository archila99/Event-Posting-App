import { useEffect, useState } from "react";
import {
  admin,
  locations,
  timeSlots,
  users,
} from "../api";
import type { EventItem } from "../api";
import type { User } from "../api";

type Tab = "events" | "locations" | "slots" | "reservations" | "purchases" | "audit" | "users";

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("events");
  const [eventList, setEventList] = useState<EventItem[]>([]);
  const [locList, setLocList] = useState<Awaited<ReturnType<typeof locations.all>>>([]);
  const [slotList, setSlotList] = useState<Awaited<ReturnType<typeof timeSlots.all>>>([]);
  const [resList, setResList] = useState<unknown[]>([]);
  const [purchaseList, setPurchaseList] = useState<unknown[]>([]);
  const [auditList, setAuditList] = useState<unknown[]>([]);
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [showLocForm, setShowLocForm] = useState(false);
  const [showSlotForm, setShowSlotForm] = useState(false);
  const [locForm, setLocForm] = useState({ name: "", maxCapacity: 100 });
  const [slotForm, setSlotForm] = useState({ name: "", startTime: "13:00", endTime: "17:00" });
  const [capacityOverride, setCapacityOverride] = useState<{ id: string; value: string } | null>(null);

  const load = (signal?: AbortSignal) => {
    setLoading(true);
    if (tab === "events")
      admin
        .events(signal)
        .then(setEventList)
        .catch((err) => {
          if ((err as { name?: string })?.name !== "AbortError") setEventList([]);
        })
        .finally(() => setLoading(false));
    else if (tab === "locations")
      locations.all().then(setLocList).catch(() => setLocList([])).finally(() => setLoading(false));
    else if (tab === "slots")
      timeSlots.all().then(setSlotList).catch(() => setSlotList([])).finally(() => setLoading(false));
    else if (tab === "reservations")
      admin.reservations().then(setResList).catch(() => setResList([])).finally(() => setLoading(false));
    else if (tab === "purchases")
      admin.purchases().then(setPurchaseList).catch(() => setPurchaseList([])).finally(() => setLoading(false));
    else if (tab === "audit")
      admin.audit().then(setAuditList).catch(() => setAuditList([])).finally(() => setLoading(false));
    else if (tab === "users")
      users.list().then(setUserList).catch(() => setUserList([])).finally(() => setLoading(false));
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [tab]);

  const notify = (type: "ok" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "events", label: "Events" },
    { id: "locations", label: "Locations" },
    { id: "slots", label: "Time slots" },
    { id: "reservations", label: "Reservations" },
    { id: "purchases", label: "Purchases" },
    { id: "audit", label: "Audit" },
    { id: "users", label: "Users" },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Admin dashboard</h1>
        <p>Manage locations, time slots, events, and view all reservations and purchases</p>
      </div>
      {message && (
        <p className={"mb-4 " + (message.type === "error" ? "text-message-error" : "text-message-success")}>
          {message.text}
        </p>
      )}
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"btn " + (tab === t.id ? "btn-primary" : "btn-secondary") + " btn-sm"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "events" && (
        <>
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid">
              {eventList.map((e: EventItem & { taken?: number; available?: number }) => (
                <div key={e.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem 0" }}>{e.title || "Concert"}</h4>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>
                      {e.artist.name}[artist] · {e.location.name} · {e.date} · {e.timeSlot.name}
                    </p>
                    <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.875rem" }}>
                      Capacity: {e.taken ?? 0}/{e.capacity}
                    </p>
                    <span className={"badge " + (e.status === "APPROVED" ? "badge-approve" : "badge-cancel")}>
                      {e.status}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {e.status === "APPROVED" && (
                      <button className="btn btn-danger btn-sm" onClick={async () => { await admin.cancelEvent(e.id); load(); notify("ok", "Event cancelled"); }}>
                        Cancel / delete event
                      </button>
                    )}
                    {e.status === "APPROVED" && (
                      <>
                        {capacityOverride?.id === e.id ? (
                          <>
                            <input
                              type="number"
                              min={e.taken ?? 0}
                              max={e.location.maxCapacity}
                              value={capacityOverride.value}
                              onChange={(ev) => setCapacityOverride((c) => (c ? { ...c, value: ev.target.value } : null))}
                              style={{ width: 80, padding: "0.4rem" }}
                            />
                            <button className="btn btn-primary btn-sm" onClick={async () => {
                              if (!capacityOverride || capacityOverride.id !== e.id) return;
                              await admin.overrideCapacity(e.id, Number(capacityOverride.value));
                              setCapacityOverride(null);
                              load();
                              notify("ok", "Capacity updated");
                            }}>
                              Set
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setCapacityOverride(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={() => setCapacityOverride({ id: e.id, value: String(e.capacity) })}>
                            Override capacity
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "locations" && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Locations</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowLocForm(!showLocForm)}
            >
              {showLocForm ? "Cancel" : "Add location"}
            </button>
          </div>
          {showLocForm && (
            <form
              className="card mb-6 max-w-md"
              onSubmit={async (ev) => {
                ev.preventDefault();
                await locations.create(locForm);
                setLocForm({ name: "", maxCapacity: 100 });
                setShowLocForm(false);
                load();
                notify("ok", "Location created");
              }}
            >
              <div className="form-group mb-4">
                <label>Name</label>
                <input
                  value={locForm.name}
                  onChange={(e) => setLocForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="form-group mb-4">
                <label>Max capacity</label>
                <input
                  type="number"
                  min={1}
                  value={locForm.maxCapacity}
                  onChange={(e) => setLocForm((f) => ({ ...f, maxCapacity: Number(e.target.value) }))}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Create location
              </button>
            </form>
          )}
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid">
              {locList.map((l) => (
                <div key={l.id} className="card flex items-center justify-between">
                  <span>{l.name} — max {l.maxCapacity} {!l.isActive && "(inactive)"}</span>
                  {l.isActive && (
                    <button className="btn btn-danger btn-sm" onClick={async () => { await locations.deactivate(l.id); load(); notify("ok", "Deactivated"); }}>Deactivate</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "slots" && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Time slots</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowSlotForm(!showSlotForm)}
            >
              {showSlotForm ? "Cancel" : "Add time slot"}
            </button>
          </div>
          {showSlotForm && (
            <form
              className="card mb-6 max-w-md"
              onSubmit={async (ev) => {
                ev.preventDefault();
                await timeSlots.create(slotForm);
                setSlotForm({ name: "", startTime: "13:00", endTime: "17:00" });
                setShowSlotForm(false);
                load();
                notify("ok", "Time slot created");
              }}
            >
              <div className="form-group mb-4">
                <label>Name</label>
                <input
                  value={slotForm.name}
                  onChange={(e) => setSlotForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="form-group mb-4">
                <label>Start time (HH:MM)</label>
                <input
                  value={slotForm.startTime}
                  onChange={(e) => setSlotForm((f) => ({ ...f, startTime: e.target.value }))}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="form-group mb-4">
                <label>End time (HH:MM)</label>
                <input
                  value={slotForm.endTime}
                  onChange={(e) => setSlotForm((f) => ({ ...f, endTime: e.target.value }))}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Create time slot
              </button>
            </form>
          )}
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid">
              {slotList.map((s) => (
                <div key={s.id} className="card flex items-center justify-between">
                  <span>{s.name} — {s.startTime}–{s.endTime} {!s.isActive && "(inactive)"}</span>
                  {s.isActive && (
                    <button className="btn btn-danger btn-sm" onClick={async () => { await timeSlots.deactivate(s.id); load(); notify("ok", "Deactivated"); }}>Deactivate</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "reservations" && (
        loading ? <p className="text-muted-foreground">Loading…</p> : (
          <div className="card">
            <pre style={{ margin: 0, fontSize: "0.8rem", overflow: "auto" }}>{JSON.stringify(resList, null, 2)}</pre>
          </div>
        )
      )}

      {tab === "purchases" && (
        loading ? <p className="text-muted-foreground">Loading…</p> : (
          Array.isArray(purchaseList) && purchaseList.length === 0 ? (
            <p className="text-muted-foreground">No purchases yet.</p>
          ) : Array.isArray(purchaseList) ? (
            <div className="grid">
              {(purchaseList as Array<{ id: string; status: string; purchasedAt: string | null; event: { id: string; date: string; title?: string | null }; user: { name: string; email: string } }>).map((t) => (
                <div key={t.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div>
                    <strong>Ticket {t.id.slice(0, 8)}…</strong> — {t.user?.name} ({t.user?.email}) · {t.event?.date} {t.event?.title ? `· ${t.event.title}` : ""}
                  </div>
                  {t.status === "SOLD" && (
                    <button className="btn btn-danger btn-sm" onClick={async () => { await admin.refundTicket(t.id); load(); notify("ok", "Ticket refunded"); }}>
                      Refund
                    </button>
                  )}
                  {t.status !== "SOLD" && <span className="badge badge-cancel">{t.status}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="card"><pre style={{ margin: 0, fontSize: "0.8rem", overflow: "auto" }}>{JSON.stringify(purchaseList, null, 2)}</pre></div>
          )
        )
      )}

      {tab === "audit" && (
        loading ? <p className="text-muted-foreground">Loading…</p> : (
          <div className="card">
            <pre style={{ margin: 0, fontSize: "0.8rem", overflow: "auto" }}>{JSON.stringify(auditList, null, 2)}</pre>
          </div>
        )
      )}

      {tab === "users" && (
        loading ? <p className="text-muted-foreground">Loading…</p> : (
          <div className="grid">
            {userList.map((u) => (
              <div key={u.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{u.name}[{u.role.toLowerCase()}] — {u.email}</span>
                {u.role !== "ADMIN" && (
                  <button className="btn btn-danger btn-sm" onClick={async () => { await admin.deactivateUser(u.id); load(); notify("ok", "User deactivated"); }}>Deactivate</button>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}
