import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { comments, events, reservations } from "../api";
import { useAuth } from "../AuthContext";
import type { EventItem } from "../api";
import type { EventComment } from "../api";

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [event, setEvent] = useState<(EventItem & { taken: number; available: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [commentList, setCommentList] = useState<EventComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string>("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string>("");
  const [postingReply, setPostingReply] = useState(false);

  useEffect(() => {
    if (!id) return;
    events.get(id).then(setEvent).catch(() => setEvent(null)).finally(() => setLoading(false));
  }, [id]);

  const refreshComments = async () => {
    if (!id) return;
    setLoadingComments(true);
    try {
      const list = await comments.list(id);
      setCommentList(list);
    } catch {
      setCommentList([]);
    } finally {
      setLoadingComments(false);
    }
  };

  useEffect(() => {
    refreshComments();
  }, [id]);

  const handleReserve = async () => {
    if (!user) {
      setMessage({ type: "error", text: "Please log in to reserve tickets." });
      return;
    }
    if (!event || event.status !== "APPROVED") return;
    setReserving(true);
    setMessage(null);
    try {
      await reservations.create({ eventId: event.id, quantity: Number(quantity) });
      setMessage({ type: "ok", text: `Reservation created. You have 10 minutes to complete purchase in My Reservations.` });
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Reservation failed" });
    } finally {
      setReserving(false);
    }
  };

  const handlePostComment = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!id) return;
    setCommentError("");
    if (!user) return;
    if (!commentText.trim()) return;
    setPostingComment(true);
    try {
      const created = await comments.create(id, commentText);
      setCommentText("");
      setCommentList((prev) => [created, ...prev]);
    } catch (err: unknown) {
      setCommentError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  };

  const handlePostReply = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!id) return;
    if (!user) return;
    if (!replyTo) return;
    setCommentError("");
    if (!replyText.trim()) return;
    setPostingReply(true);
    try {
      const created = await comments.create(id, replyText, replyTo);
      setReplyText("");
      setReplyTo(null);
      setCommentList((prev) => [created, ...prev]);
    } catch (err: unknown) {
      setCommentError(err instanceof Error ? err.message : "Failed to post reply");
    } finally {
      setPostingReply(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!id) return;
    setCommentError("");
    if (!user) return;
    try {
      await comments.delete(id, commentId);
      setCommentList((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err: unknown) {
      setCommentError(err instanceof Error ? err.message : "Failed to delete comment");
    }
  };

  const commentById = new Map(commentList.map((c) => [c.id, c]));
  const childrenByParent = new Map<string, EventComment[]>();
  const roots: EventComment[] = [];
  for (const c of commentList) {
    const parentId = c.parentId ?? null;
    if (!parentId) roots.push(c);
    else {
      const arr = childrenByParent.get(parentId) ?? [];
      arr.push(c);
      childrenByParent.set(parentId, arr);
    }
  }
  // stable-ish ordering (newest first, like the API)
  const sortByDateDesc = (a: EventComment, b: EventComment) => (a.createdAt > b.createdAt ? -1 : 1);
  roots.sort(sortByDateDesc);
  for (const [pid, arr] of childrenByParent) {
    // ignore replies whose parent is missing (deleted) by treating as root
    if (!commentById.has(pid)) {
      roots.push(...arr);
      childrenByParent.delete(pid);
    } else {
      arr.sort(sortByDateDesc);
    }
  }

  const renderComment = (c: EventComment, depth = 0) => {
    const canDelete = !!user && (user.role === "ADMIN" || user.id === c.userId);
    const replies = childrenByParent.get(c.id) ?? [];
    return (
      <div key={c.id} className="rounded-lg border bg-card/40 p-4" style={{ marginLeft: depth ? depth * 16 : 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="text-sm">
              {c.user?.name || "User"}
              {c.user?.role ? `[${c.user.role.toLowerCase()}]` : ""}
            </strong>
            <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            {user && c.userId !== user.id && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setReplyTo(c.id);
                  setReplyText("");
                }}
              >
                Reply
              </button>
            )}
            {canDelete && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDeleteComment(c.id)}>
                Delete
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{c.content}</p>

        {replyTo === c.id && user && (
          <form onSubmit={handlePostReply} className="mt-3 space-y-2">
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply…"
              maxLength={500}
              required
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary btn-sm" disabled={postingReply}>
                {postingReply ? "Posting…" : "Post reply"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setReplyTo(null);
                  setReplyText("");
                }}
              >
                Cancel
              </button>
              <span className="text-xs text-muted-foreground self-center">{replyText.length}/500</span>
            </div>
          </form>
        )}

        {replies.length > 0 && <div className="mt-3 space-y-3">{replies.map((r) => renderComment(r, depth + 1))}</div>}
      </div>
    );
  };

  if (loading || !event) {
    return <p className="text-muted-foreground">{loading ? "Loading…" : "Event not found."}</p>;
  }

  return (
    <>
      <p className="mb-4">
        <Link to="/">← Events</Link>
      </p>
      <div className="card mb-4">
        <div className="flex flex-wrap items-start gap-6">
          {event.imageUrl && (
            <img src={event.imageUrl} alt="" className="h-[200px] w-[200px] rounded-lg object-cover" />
          )}
          <div className="min-w-[200px] flex-1">
            <h1 className="mb-2 text-2xl font-semibold">{event.title || "Concert"}</h1>
            <p className="text-muted-foreground">
              {event.artist.name}[artist] · {event.location.name}
            </p>
            <p className="mt-1.5">
              {event.date} · {event.timeSlot.name} ({event.timeSlot.startTime}–{event.timeSlot.endTime})
            </p>
            <p className="mt-1.5">
              <strong>{event.available}</strong> of {event.capacity} tickets available
            </p>
            {event.description && <p className="mt-4">{event.description}</p>}
          </div>
        </div>
      </div>
      {event.status === "APPROVED" && event.available > 0 && (
        <div className="card">
          {user?.role === "USER" ? (
            <>
              <h3 className="mb-4 text-lg font-semibold">Reserve tickets</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Max 2 tickets per user. Reservation holds for 10 minutes.
              </p>
              <div className="form-group mb-4 max-w-[120px]">
                <label>Quantity</label>
                <select
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                >
                  {[1, 2].filter((n) => n <= event.available).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              {message && (
                <p className={"mb-4 text-sm " + (message.type === "error" ? "text-message-error" : "text-message-success")}>
                  {message.text}
                </p>
              )}
              {user ? (
                <button type="button" className="btn btn-primary" onClick={handleReserve} disabled={reserving}>
                  {reserving ? "Reserving…" : "Reserve tickets"}
                </button>
              ) : (
                <Link to="/login" className="btn btn-primary">Log in to reserve</Link>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              View only. Only user accounts can reserve and purchase tickets.
            </p>
          )}
        </div>
      )}

      <div className="card mt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Comments</h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => refreshComments()}
            disabled={loadingComments}
          >
            {loadingComments ? "Loading…" : "Refresh"}
          </button>
        </div>

        {loadingComments ? (
          <p className="text-muted-foreground">Loading comments…</p>
        ) : commentList.length === 0 ? (
          <p className="text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-3">
            {roots.map((c) => renderComment(c, 0))}
          </div>
        )}

        {user ? (
          <form onSubmit={handlePostComment} className="mt-4">
            {commentError && (
              <p className="mb-3 text-sm text-message-error">
                {commentError}
              </p>
            )}
            <div className="form-group mb-3">
              <label>Add a comment</label>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={3}
                placeholder="Write your comment…"
                maxLength={500}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {commentText.length}/500
              </p>
            </div>
            <button type="submit" className="btn btn-primary" disabled={postingComment}>
              {postingComment ? "Posting…" : "Post comment"}
            </button>
          </form>
        ) : (
          <p className="mt-4 text-muted-foreground">
            <Link to="/login">Log in</Link> to comment.
          </p>
        )}
      </div>
    </>
  );
}
