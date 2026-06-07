import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Bike } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold leading-tight">Ankit Motors</div>
              <div className="text-xs text-muted-foreground">Buxar · Inventory</div>
            </div>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
