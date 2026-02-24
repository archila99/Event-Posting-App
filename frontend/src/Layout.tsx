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

const ALLOWED_UNVERIFIED_PATHS = ["/verify-email", "/login", "/register"];

function NavLink({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  const location = useLocation();
  const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to + "/"));
  return (
    <Link
      to={to}
      onClick={onClick}
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

function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className="block h-5 w-6 flex-shrink-0">
      {open ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-full">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-full">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )}
    </span>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (user && !user.emailVerifiedAt && user.role !== "ADMIN" && !ALLOWED_UNVERIFIED_PATHS.includes(location.pathname)) {
      navigate("/verify-email", { replace: true });
    }
  }, [user, location.pathname, navigate]);

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const closeMenu = () => setMobileMenuOpen(false);

  const navContent = (
    <>
      <NavLink to="/" onClick={closeMenu}>Events</NavLink>
      {user && (
        <>
          {user.role === "ADMIN" && <NavLink to="/admin" onClick={closeMenu}>Admin</NavLink>}
          {user.role === "ARTIST" && <NavLink to="/artist" onClick={closeMenu}>My events</NavLink>}
          {showReservationsAndTickets && (
            <>
              <NavLink to="/reservations" onClick={closeMenu}>Reservations</NavLink>
              <NavLink to="/tickets" onClick={closeMenu}>My tickets</NavLink>
            </>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="container flex h-14 min-h-[44px] items-center justify-between gap-2 px-4 sm:px-6">
          <Link to="/" className="text-lg font-semibold tracking-tight sm:text-xl">
            EventBooking
          </Link>
          {/* Desktop nav */}
          <nav className="hidden items-center gap-3 md:flex">
            {navContent}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="ml-1 h-9 px-2 text-foreground/80 hover:text-foreground">
                    <span className="max-w-[140px] truncate">{user.name}[{user.role.toLowerCase()}]</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => navigate("/")}>Events</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
                    {themeLabel}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={handleLogout}>
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
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
          {/* Mobile: hamburger */}
          <div className="flex items-center gap-1 md:hidden">
            {user && (
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 min-h-[44px] min-w-[44px]"
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                aria-label={themeLabel}
              >
                <span className="text-lg">{theme === "dark" ? "☀️" : "🌙"}</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 min-h-[44px] min-w-[44px]"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              <MenuIcon open={mobileMenuOpen} />
            </Button>
          </div>
        </div>
      </header>
      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur md:hidden"
          style={{ paddingLeft: "env(safe-area-inset-left)", paddingTop: "env(safe-area-inset-top)" }}
          aria-modal="true"
          role="dialog"
          aria-label="Menu"
        >
          <div className="flex h-14 min-h-[44px] items-center justify-between border-b px-4">
            <span className="text-lg font-semibold">Menu</span>
            <Button variant="ghost" size="icon" className="h-10 w-10 min-h-[44px] min-w-[44px]" onClick={closeMenu} aria-label="Close menu">
              <MenuIcon open={true} />
            </Button>
          </div>
          <nav className="flex flex-col gap-0 p-4">
            <Link to="/" onClick={closeMenu} className="flex min-h-[48px] items-center rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">
              Events
            </Link>
            {user && (
              <>
                {user.role === "ADMIN" && <Link to="/admin" onClick={closeMenu} className="flex min-h-[48px] items-center rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">Admin</Link>}
                {user.role === "ARTIST" && <Link to="/artist" onClick={closeMenu} className="flex min-h-[48px] items-center rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">My events</Link>}
                {showReservationsAndTickets && (
                  <>
                    <Link to="/reservations" onClick={closeMenu} className="flex min-h-[48px] items-center rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">Reservations</Link>
                    <Link to="/tickets" onClick={closeMenu} className="flex min-h-[48px] items-center rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">My tickets</Link>
                  </>
                )}
              </>
            )}
            {user ? (
              <>
                <div className="my-2 border-t pt-2" />
                <button
                  type="button"
                  onClick={() => { setTheme((t) => (t === "dark" ? "light" : "dark")); closeMenu(); }}
                  className="flex min-h-[48px] w-full items-center rounded-lg px-3 py-3 text-left text-base font-medium text-foreground/80 hover:bg-accent hover:text-foreground"
                >
                  {themeLabel}
                </button>
                <button
                  type="button"
                  onClick={() => { handleLogout(); closeMenu(); }}
                  className="flex min-h-[48px] w-full items-center rounded-lg px-3 py-3 text-left text-base font-medium text-destructive hover:bg-destructive/10"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <div className="my-2 border-t pt-2" />
                <Link
                  to="/login"
                  onClick={closeMenu}
                  className="flex min-h-[48px] items-center justify-center rounded-lg px-3 py-3 text-base font-medium text-primary hover:bg-accent"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  onClick={closeMenu}
                  className="flex min-h-[48px] items-center justify-center rounded-lg px-3 py-3 text-base font-medium text-primary-foreground bg-primary hover:bg-primary/90"
                >
                  Register
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
      <main className="min-h-[50vh] py-4 sm:py-6">
        <div className="container px-4 sm:px-6">
          <Outlet />
        </div>
      </main>
    </>
  );
}
