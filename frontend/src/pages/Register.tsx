import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../api";
import type { Role } from "../api";
import { useAuth } from "../AuthContext";
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
  const [otpPreview, setOtpPreview] = useState<string | null>(null);
  const [signupSessionId, setSignupSessionId] = useState<string | null>(() => localStorage.getItem("signupSessionId"));
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
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
      const emailNorm = email.trim().toLowerCase();
      const r = await auth.register({ email: emailNorm, password, name, role });
      setOtpPreview(r.otpPreview);
      setSignupSessionId(r.sessionId);
      localStorage.setItem("signupSessionId", r.sessionId);
      setEmail(emailNorm);
      logout();
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
    if (!signupSessionId) {
      setVerifyError("Signup session not found. Please register again.");
      return;
    }
    setVerifyError("");
    setVerifyLoading(true);
    try {
      const { token } = await auth.verifyOtp(signupSessionId, code);
      localStorage.setItem("token", token);
      localStorage.removeItem("signupSessionId");
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
    // For strict pending sessions, we intentionally avoid "resend" without server-side session renewal endpoint.
    setVerifyError("OTP can’t be resent in this demo flow yet. Please register again to generate a new OTP.");
  };

  if (pendingVerification) {
    return (
      <div className="mx-auto mt-6 w-full max-w-sm px-1 sm:mt-10">
        <Card className="shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle>Verify your email</CardTitle>
            <CardDescription>
              OTP preview (no email). Your verification code is:{" "}
              <strong className="font-mono tracking-[0.25em]">{otpPreview ?? "------"}</strong>
            </CardDescription>
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
              <Button type="submit" className="w-full min-h-[44px] text-base" disabled={verifyCode.length !== 6 || verifyLoading}>
                {verifyLoading ? "Verifying…" : "Verify and continue"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full min-h-[44px] text-base"
                disabled={resendCooldown > 0}
                onClick={handleResendCode}
              >
                {resendCooldown > 0 ? `Resend code (in ${resendCooldown}s)` : "Resend code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-sm px-1 sm:mt-10">
      <Card className="shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Create account</CardTitle>
          <CardDescription>Join Ticket Book. After sign up, a one-time code will be shown on screen (demo mode).</CardDescription>
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
              <select className="h-10 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="USER">User (buy tickets)</option>
                <option value="ARTIST">Artist (post events)</option>
              </select>
            </div>
            <Button type="submit" className="w-full min-h-[44px] text-base" disabled={loading}>
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
