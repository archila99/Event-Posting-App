import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await auth.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="mx-auto mt-6 w-full max-w-sm px-1 sm:mt-10">
        <Card className="shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle>Check your email</CardTitle>
            <CardDescription className="space-y-2">
              <p>
                If an account exists with <strong>{email}</strong>, we sent a 6-digit password reset code. Check your inbox and spam folder. The code expires in 10 minutes.
              </p>
              <p className="text-muted-foreground">
                Forgot password only works after you have finished signup (you have a login). If you are still on the “verify email” step from Register, use that screen or “Resend code” there — not this page.
              </p>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full min-h-[44px] text-base"
              onClick={() => navigate("/reset-password", { state: { email: email.trim().toLowerCase() } })}
            >
              Enter code and set new password
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              <Link to="/login">Back to login</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-sm px-1 sm:mt-10">
      <Card className="shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Forgot password</CardTitle>
          <CardDescription>
            Enter your account email. We&apos;ll send a 6-digit code so you can set a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
            <Button type="submit" className="w-full min-h-[44px] text-base" disabled={loading}>
              {loading ? "Sending…" : "Send reset code"}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              <Link to="/login">Back to login</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
