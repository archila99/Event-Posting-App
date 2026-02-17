import { Routes, Route, Navigate } from "react-router-dom";
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

function PrivateRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container" style={{ padding: "2rem", textAlign: "center" }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route
          path="dashboard"
          element={
            <PrivateRoute>
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
            <PrivateRoute roles={["ARTIST"]}>
              <ArtistDashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="reservations"
          element={
            <PrivateRoute roles={["USER"]}>
              <MyReservations />
            </PrivateRoute>
          }
        />
        <Route
          path="tickets"
          element={
            <PrivateRoute roles={["USER"]}>
              <MyTickets />
            </PrivateRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
