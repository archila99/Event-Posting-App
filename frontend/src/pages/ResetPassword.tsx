import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";

export default function ResetPassword() {
  const location = useLocation();
  const emailFromState = (location.state as { email?: string } | null)?.email ?? "";
  const [email, setEmail] = useState(emailFromState);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setError("Password reset is not available in the OTP-only demo. Please create a new account.");
  };

  return (
    <div className="mx-auto mt-6 w-full max-w-sm px-1 sm:mt-10">
      <Card className="shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Set new password</CardTitle>
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
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">6-digit code</label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-32 font-mono tracking-[0.25em]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">New password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="At least 6 characters"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Confirm new password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="Same as above"
              />
            </div>
            <Button type="submit" className="w-full min-h-[44px] text-base">
              Go to register
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              <Link to="/register">Register</Link> · <Link to="/login">Back to login</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
