import { Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "ADMIN") return <Navigate to="/admin" replace />;
  if (user?.role === "ARTIST") return <Navigate to="/artist" replace />;
  return <Navigate to="/" replace />;
}
