import { useEffect, useState } from "react";
import { events } from "../api";
import type { EventItem } from "../api";
import { CreateEventForm } from "../components/events/CreateEventForm";
import { EventPost } from "../components/events/EventPost";
import { Button } from "../components/ui/button";

export default function ArtistDashboard() {
  const [list, setList] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = (signal?: AbortSignal) => {
    events
      .myEvents(signal)
      .then(setList)
      .catch((err) => {
        if ((err as { name?: string })?.name !== "AbortError") setList([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, []);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Artist</h1>
          <p className="text-sm text-muted-foreground">Create upcoming events like a post. If the slot is free, it goes live instantly.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? "Close" : "New post"}</Button>
      </div>
      {showForm && (
        <CreateEventForm
          onSuccess={() => {
            setShowForm(false);
            refresh();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">My events</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet. Create your first post above.</p>
      ) : (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
          {list.map((e) => (
            <EventPost key={e.id} e={e} viewerRole={"ARTIST"} />
          ))}
        </div>
      )}
    </>
  );
}
