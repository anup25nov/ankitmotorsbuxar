import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Bike, Users } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold leading-tight">Ankit Motors</div>
              <div className="text-xs text-muted-foreground">Buxar</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/" icon={<Bike className="h-4 w-4" />}>
              Inventory
            </NavLink>
            <NavLink to="/leads" icon={<Users className="h-4 w-4" />}>
              Leads
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

function NavLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      activeProps={{ className: "bg-accent text-foreground font-medium" }}
    >
      {icon}
      {children}
    </Link>
  );
}
