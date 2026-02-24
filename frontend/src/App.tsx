import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import Layout from "./Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import EventDetail from "./pages/EventDetail";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import ArtistDashboard from "./pages/ArtistDashboard";
import MyReservations from "./pages/MyReservations";
import MyTickets from "./pages/MyTickets";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

function PrivateRoute({
  children,
  roles,
  requireVerified,
}: {
  children: React.ReactNode;
  roles?: string[];
  requireVerified?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container" style={{ padding: "2rem", textAlign: "center" }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  if (requireVerified && !user.emailVerifiedAt && user.role !== "ADMIN") {
    return <Navigate to="/verify-email" replace />;
  }
  return <>{children}</>;
}

function VerificationRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => navigate("/verify-email", { replace: true });
    window.addEventListener("verification-required", handler);
    return () => window.removeEventListener("verification-required", handler);
  }, [navigate]);
  return null;
}

function AppRoutes() {
  return (
    <>
      <VerificationRedirect />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route
          path="dashboard"
          element={
            <PrivateRoute requireVerified>
              <Dashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="admin"
          element={
            <PrivateRoute roles={["ADMIN"]}>
              <AdminDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="artist"
          element={
            <PrivateRoute roles={["ARTIST"]} requireVerified>
              <ArtistDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="reservations"
          element={
            <PrivateRoute roles={["USER"]} requireVerified>
              <MyReservations />
            </PrivateRoute>
          }
        />
        <Route
          path="tickets"
          element={
            <PrivateRoute roles={["USER"]} requireVerified>
              <MyTickets />
            </PrivateRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
