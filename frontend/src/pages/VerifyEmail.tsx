import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

export default function VerifyEmail() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // This app now enforces OTP verification during signup with a sessionId.
    // The verification UI lives in the Register flow (it displays OTP preview).
    if (user?.emailVerifiedAt) {
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/register", { replace: true });
    }
  }, [navigate, user?.emailVerifiedAt]);

  return null;
}
