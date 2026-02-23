import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../api";
import type { Role } from "../api";
import { useAuth, setSessionExpiry } from "../AuthContext";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("USER");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [emailSent, setEmailSent] = useState(true);
  const [emailError, setEmailError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh, logout } = useAuth();

  useEffect(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    if (!pendingVerification || resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((prev) => (prev <= 0 ? 0 : prev - 1)), 1000);
    return () => clearInterval(t);
  }, [pendingVerification, resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { message, emailError: errMsg } = await auth.register({
        email,
        password,
        name,
        role,
      });
      logout();
      setEmailSent(!errMsg && (message ?? "").includes("sent to your email"));
      setEmailError(errMsg ?? null);
      setPendingVerification(true);
      setVerifyCode("");
      setResendCooldown(60);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = verifyCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) return;
    const emailNorm = email.trim().toLowerCase();
    setVerifyError("");
    setVerifyLoading(true);
    try {
      const { token } = await auth.verifyEmail(emailNorm, code);
      localStorage.setItem("token", token);
      setSessionExpiry();
      await refresh();
      setPendingVerification(false);
      navigate("/dashboard");
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResendCode = async () => {
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm || resendCooldown > 0) return;
    setResendLoading(true);
    setVerifyError("");
    try {
      await auth.resendVerificationCode(emailNorm);
      setResendCooldown(60);
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setResendLoading(false);
    }
  };

  if (pendingVerification) {
    return (
      <div className="mx-auto mt-10 w-full max-w-sm">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>Verify your email</CardTitle>
            <CardDescription>
              {emailSent
                ? <>We sent a 6-digit code to <strong>{email}</strong>. Enter it below (valid 10 minutes). Check spam if you don’t see it.</>
                : <>We couldn&apos;t send the code to <strong>{email}</strong>. Use &quot;Resend code&quot; or set SMTP in backend/.env.</>}
            </CardDescription>
            {emailError && (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{emailError}</p>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerify} className="space-y-4">
              {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Verification code</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => {
                    setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setVerifyError("");
                  }}
                  className="w-32 font-mono tracking-[0.25em]"
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifyCode.length !== 6 || verifyLoading}>
                {verifyLoading ? "Verifying…" : "Verify and continue"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={resendLoading || resendCooldown > 0}
                onClick={handleResendCode}
              >
                {resendLoading ? "Sending…" : resendCooldown > 0 ? `Resend code (in ${resendCooldown}s)` : "Resend code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Create account</CardTitle>
          <CardDescription>Join Ticket Book. We&apos;ll send a verification code to your email after you sign up.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive">
                {error}
                {error === "Email already registered" && " Use the link below to log in."}
              </p>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
              <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Role</label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="USER">User (buy tickets)</option>
                <option value="ARTIST">Artist (post events)</option>
              </select>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account…" : "Register"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
