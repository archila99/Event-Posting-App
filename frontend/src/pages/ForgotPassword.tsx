import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
      // Email-based password reset was removed in the OTP-only auth flow.
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
            <CardTitle>Reset not available</CardTitle>
            <CardDescription className="space-y-2">
              <p>
                Password reset via email has been removed in this OTP-only demo. Create a new account instead.
              </p>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full min-h-[44px] text-base"
              onClick={() => navigate("/register", { replace: true })}
            >
              Go to register
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
            Password reset is not available in the OTP-only demo.
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
