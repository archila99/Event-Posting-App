import { useEffect, useRef, useState } from "react";
import { events, locations, timeSlots, uploadEventImage } from "../../api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type CreateEventFormProps = {
  onSuccess: () => void;
  onCancel: () => void;
};

export function CreateEventForm({ onSuccess, onCancel }: CreateEventFormProps) {
  const [locList, setLocList] = useState<Array<{ id: string; name: string; maxCapacity: number }>>([]);
  const [slotList, setSlotList] = useState<Array<{ id: string; name: string; startTime: string; endTime: string }>>([]);
  const [form, setForm] = useState({
    locationId: "",
    date: "",
    timeSlotId: "",
    capacity: 100,
    imageUrl: "",
  });
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    locations.list().then(setLocList).catch(() => setLocList([]));
    timeSlots.list().then(setSlotList).catch(() => setSlotList([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);
    try {
      const title = titleRef.current?.value?.trim() || undefined;
      const description = descriptionRef.current?.value?.trim() || undefined;
      let imageUrl = form.imageUrl.trim() || undefined;
      if (imageFile) {
        const { url } = await uploadEventImage(imageFile);
        imageUrl = url;
      }
      await events.create({
        locationId: form.locationId,
        date: form.date,
        timeSlotId: form.timeSlotId,
        capacity: form.capacity,
        title,
        description,
        imageUrl,
      });
      onSuccess();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mb-6 overflow-hidden">
      <form onSubmit={handleSubmit} className="grid gap-0 md:grid-cols-2">
        <div className="border-b bg-muted/40 p-4 md:border-b-0 md:border-r">
          <div className="text-sm font-semibold">Create post</div>
          <p className="mt-1 text-xs text-muted-foreground">Add an image (optional) and event details.</p>
          <div className="mt-4">
            {imageFile ? (
              <div className="aspect-square w-full overflow-hidden rounded-md border bg-background">
                <img src={URL.createObjectURL(imageFile)} alt="" className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="grid aspect-square w-full place-items-center rounded-md border bg-background text-sm text-muted-foreground">
                Image preview
              </div>
            )}
          </div>
          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Event photo (optional)</label>
            <Input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setImageFile(f || null);
                if (!f) setForm((prev) => ({ ...prev, imageUrl: "" }));
              }}
            />
            <div className="text-xs text-muted-foreground">Or paste image URL:</div>
            <Input value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." />
          </div>
        </div>

        <div className="p-4">
          {submitError && <p className="mb-3 text-sm text-destructive">{submitError}</p>}
          <div className="grid grid-2 gap-4">
            <div className="form-group">
              <label>Location</label>
              <select
                value={form.locationId}
                onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                required
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select</option>
                {locList.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} (max {l.maxCapacity})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <Input type="date" min={todayISO()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Time slot</label>
              <select
                value={form.timeSlotId}
                onChange={(e) => setForm((f) => ({ ...f, timeSlotId: e.target.value }))}
                required
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select</option>
                {slotList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startTime}–{s.endTime})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Capacity</label>
              <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))} required />
            </div>
          </div>
          <div className="mt-2 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Title</label>
              <Input ref={titleRef} defaultValue="" name="title" placeholder="Event title (optional)" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <Textarea ref={descriptionRef} defaultValue="" name="description" rows={3} placeholder="Describe your event (optional)" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Posting…" : "Post"}
              </Button>
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Card>
  );
}
