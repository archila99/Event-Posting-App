import { memo } from "react";
import { Link } from "react-router-dom";
import type { EventItem, Role } from "../../api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

function EventPostInner({ e, viewerRole }: { e: EventItem; viewerRole?: Role }) {
  const available = e.available ?? (e.capacity - (e.taken ?? 0));
  const canReserve = viewerRole === "USER";

  return (
    <Card className="overflow-hidden border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full border bg-background text-xs font-semibold">
            {initials(e.artist.name)}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{e.artist.name}[artist]</div>
            <div className="text-xs text-muted-foreground">{e.location.name}</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">{e.date}</div>
      </div>

      {e.imageUrl ? (
        <div className="bg-muted">
          <img src={e.imageUrl} alt="" className="aspect-square w-full object-cover" />
        </div>
      ) : (
        <div className="grid aspect-square w-full place-items-center bg-muted text-sm text-muted-foreground">
          No image
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{e.title || "Concert"}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {e.timeSlot.name} ({e.timeSlot.startTime}–{e.timeSlot.endTime}) ·{" "}
              <span className="font-medium text-foreground">{available}</span> / {e.capacity} available
            </div>
            {e.description && (
              <p className="mt-2 line-clamp-2 text-sm text-foreground/90">{e.description}</p>
            )}
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link to={"/events/" + e.id}>{canReserve ? "View & reserve" : "View"}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export const EventPost = memo(EventPostInner);

