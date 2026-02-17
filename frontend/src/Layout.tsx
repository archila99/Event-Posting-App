import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { cn } from "./lib/utils";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { useEffect, useMemo, useState } from "react";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to + "/"));
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "px-2 py-1 text-sm font-medium text-foreground/70 transition-colors hover:text-foreground",
        active && "text-foreground"
      )}
    >
      <span className={cn("pb-1", active && "border-b-2 border-primary")}>{children}</span>
    </Link>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const themeLabel = useMemo(() => (theme === "dark" ? "Day mode" : "Night mode"), [theme]);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const showReservationsAndTickets = user?.role === "USER";

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="container flex h-14 items-center justify-between gap-4">
          <Link to="/" className="text-xl font-semibold tracking-tight">
            EventBooking
          </Link>
          <nav className="flex items-center gap-3">
            <NavLink to="/">Events</NavLink>
            {user && (
              <>
                {user.role === "ADMIN" && <NavLink to="/admin">Admin</NavLink>}
                {user.role === "ARTIST" && <NavLink to="/artist">My events</NavLink>}
                {showReservationsAndTickets && (
                  <>
                    <NavLink to="/reservations">Reservations</NavLink>
                    <NavLink to="/tickets">My tickets</NavLink>
                  </>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="ml-1 h-9 px-2 text-foreground/80 hover:text-foreground">
                      <span className="max-w-[140px] truncate">{user.name}[{user.role.toLowerCase()}]</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => navigate("/")}>Events</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                    >
                      {themeLabel}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={handleLogout}>
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {!user && (
              <>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Register</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="py-6">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  );
}
