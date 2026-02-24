import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../api";
import { useAuth, setSessionExpiry } from "../AuthContext";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";

export default function VerifyEmail() {
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.email && !user.emailVerifiedAt) setEmail(user.email);
  }, [user?.email, user?.emailVerifiedAt]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((prev) => (prev <= 0 ? 0 : prev - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    const code = verifyCode.replace(/\D/g, "").slice(0, 6);
    if (!trimmedEmail || code.length !== 6) return;
    setVerifyError("");
    setVerifyLoading(true);
    try {
      const { token } = await auth.verifyEmail(trimmedEmail, code);
      localStorage.setItem("token", token);
      setSessionExpiry();
      await refresh();
      navigate("/dashboard");
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    setVerifyCode(value.replace(/\D/g, "").slice(0, 6));
    setVerifyError("");
  };

  const handleResend = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setResendError("Enter your email first");
      return;
    }
    if (resendCooldown > 0) return;
    setResendLoading(true);
    setResendError("");
    setResendSent(false);
    try {
      await auth.resendVerificationCode(trimmedEmail);
      setResendSent(true);
      setResendCooldown(60);
    } catch (err: unknown) {
      setResendError(err instanceof Error ? err.message : "Failed to resend");
    } finally {
      setResendLoading(false);
    }
  };

  if (user?.emailVerifiedAt) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-sm px-1 sm:mt-10">
      <Card className="shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Verify your email</CardTitle>
          <CardDescription>
            Enter the email you used to register and the 6-digit code we sent (valid 10 minutes).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
            {resendSent && <p className="text-sm text-green-600">New code sent. Check your email.</p>}
            {resendError && <p className="text-sm text-destructive">{resendError}</p>}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Verification code</label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={verifyCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                className="w-32 font-mono tracking-[0.25em]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full min-h-[44px] text-base" disabled={verifyCode.length !== 6 || !email.trim() || verifyLoading}>
                {verifyLoading ? "Verifying…" : "Verify and continue"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full min-h-[44px] text-base"
                disabled={resendLoading || resendCooldown > 0 || !email.trim()}
                onClick={handleResend}
              >
                {resendLoading ? "Sending…" : resendCooldown > 0 ? `Resend code (in ${resendCooldown}s)` : "Resend code"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
