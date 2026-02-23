import { useEffect, useState } from "react";
import { reservations, tickets } from "../api";
import { useAuth } from "../AuthContext";

type ReservationItem = Awaited<ReturnType<typeof reservations.my>>[number];

export default function MyReservations() {
  const { user } = useAuth();
  const [list, setList] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [skipVerification, setSkipVerification] = useState(false);
  const [code, setCode] = useState("");
  const [purchaseError, setPurchaseError] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isVerified = !!user?.emailVerifiedAt;

  const refresh = (signal?: AbortSignal) => {
    reservations
      .my(signal)
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

  const startPurchase = (reservationId: string) => {
    setPurchasingId(reservationId);
    setCodeSent(false);
    setSkipVerification(false);
    setCode("");
    setPurchaseError("");
  };

  const cancelPurchase = () => {
    setPurchasingId(null);
    setCodeSent(false);
    setSkipVerification(false);
    setCode("");
    setPurchaseError("");
  };

  const handleStartPurchaseFlow = async () => {
    if (!purchasingId) return;
    setSendingCode(true);
    setPurchaseError("");
    try {
      const res = await tickets.sendVerificationCode(purchasingId);
      if (res.skipVerification) {
        setSkipVerification(true);
        setCodeSent(true);
      } else {
        setCodeSent(true);
      }
    } catch (err: unknown) {
      setPurchaseError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setSendingCode(false);
    }
  };

  const handleConfirmPurchase = async () => {
    if (!purchasingId) return;
    if (!skipVerification && code.length !== 6) {
      setPurchaseError("Enter the 6-digit code from your email");
      return;
    }
    setConfirming(true);
    setPurchaseError("");
    try {
      await tickets.purchase(purchasingId, skipVerification ? undefined : code);
      cancelPurchase();
      refresh();
    } catch (err: unknown) {
      setPurchaseError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>My reservations</h1>
        <p>
          Complete purchase before the reservation expires (10 minutes).
          {isVerified ? " Your email is already verified—you can confirm purchase with one click." : " A verification code will be sent to your email if needed."}
        </p>
      </div>
      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No reservations.</p>
      ) : (
        <div className="grid">
          {list.map((r) => {
            const isActive = r.status === "ACTIVE";
            const expired = isActive && new Date(r.expiresAt) < new Date();
            const isPurchasing = purchasingId === r.id;
            return (
              <div key={r.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
                  <div>
                    <h3 style={{ margin: "0 0 0.5rem 0" }}>{r.event.title || "Concert"}</h3>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>
                      {r.event.location.name} · {r.event.date} · {r.event.timeSlot.name}
                    </p>
                    <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.875rem" }}>
                      {r.quantity} ticket(s) · Expires {new Date(r.expiresAt).toLocaleString()}
                    </p>
                    <span className={"badge " + (isActive && !expired ? "badge-active" : "badge-expired")}>
                      {r.status}
                    </span>
                  </div>
                  {isActive && !expired && !isPurchasing && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        startPurchase(r.id);
                        if (isVerified) setSkipVerification(true);
                      }}
                    >
                      Purchase now
                    </button>
                  )}
                  {isActive && expired && <span className="text-sm text-muted-foreground">Expired</span>}
                </div>
                {isPurchasing && (
                  <div className="card border-primary/30 bg-muted/30">
                    <h4 className="mb-3 text-base font-semibold">
                      {skipVerification ? "Confirm purchase" : "Verify your email"}
                    </h4>
                    {skipVerification ? (
                      <>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Your email is already verified. Click below to complete the purchase.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={handleConfirmPurchase}
                            disabled={confirming}
                          >
                            {confirming ? "Confirming…" : "Confirm purchase"}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={cancelPurchase}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : !codeSent ? (
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-primary btn-sm" onClick={handleStartPurchaseFlow} disabled={sendingCode}>
                          {sendingCode ? "Sending…" : "Send verification code"}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={cancelPurchase}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="mb-3 text-sm text-message-success">
                          Code sent. Check your email and enter it below (valid 10 minutes).
                        </p>
                        <div className="form-group mb-3">
                          <label>Verification code</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="000000"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            className="w-32 font-mono tracking-[0.25em] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={handleConfirmPurchase}
                            disabled={code.length !== 6 || confirming}
                          >
                            {confirming ? "Confirming…" : "Confirm purchase"}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={handleStartPurchaseFlow} disabled={sendingCode}>
                            {sendingCode ? "Sending…" : "Send new code"}
                          </button>
                        </div>
                      </>
                    )}
                    {purchaseError && <p className="mt-3 text-sm text-message-error">{purchaseError}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
