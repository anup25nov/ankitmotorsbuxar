import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Bike, Loader2 } from "lucide-react";

type Status = "loading" | "signed-out" | "checking-role" | "no-access" | "ready";

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    const evaluate = async (session: Session | null) => {
      if (!session) {
        if (active) setStatus("signed-out");
        return;
      }
      if (active) setStatus("checking-role");
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setStatus("no-access");
        return;
      }
      setStatus("ready");
    };

    // Initial check.
    supabase.auth.getSession().then(({ data }) => evaluate(data.session));

    // Subscribe to identity transitions only.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event !== "SIGNED_IN" &&
        event !== "SIGNED_OUT" &&
        event !== "USER_UPDATED"
      )
        return;
      if (event === "SIGNED_OUT") {
        queryClient.clear();
      } else {
        queryClient.invalidateQueries();
      }
      evaluate(session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  if (status === "loading" || status === "checking-role") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "signed-out") return <AuthScreen />;

  if (status === "no-access") return <NoAccessScreen />;

  return <>{children}</>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        toast.success("Signed in");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created");
        } else {
          toast.success("Check your email to confirm your account.");
        }
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Ankit Motors Buxar</CardTitle>
              <CardDescription>Owner dashboard sign-in</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {mode === "signin"
                ? "First time? Create the owner account"
                : "Already have an account? Sign in"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NoAccessScreen() {
  const signOut = async () => {
    await supabase.auth.signOut();
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            This account isn't authorised to view the Ankit Motors dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
