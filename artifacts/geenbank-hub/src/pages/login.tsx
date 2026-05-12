import { useState } from "react";
import { useLocation, Redirect } from "wouter";
import { useLogin, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2, Info, Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: session, isLoading: sessionLoading } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      // Match AuthProvider: never auto-refetch session here. A stale
      // in-flight `/auth/me` started without a cookie would otherwise
      // resolve after login completes and overwrite the cache with
      // `{ user: null }`, triggering a /login ↔ /dashboard redirect loop.
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  });
  const loginMutation = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Cancel any in-flight `/auth/me` request so it cannot resolve after
    // login completes and overwrite the freshly-authenticated cache with
    // `{ user: null }`.
    await queryClient.cancelQueries({ queryKey: getGetCurrentUserQueryKey() });
    loginMutation.mutate({ data: { email, password } }, {
      onSuccess: (data) => {
        // Use a full page navigation rather than wouter's setLocation +
        // setQueryData. The setQueryData approach hit a React Query
        // observer-notification edge case where AuthProvider's existing
        // `useGetCurrentUser` subscriber did not pick up the cached
        // session, leading to ProtectedRoute redirecting back to /login
        // while /login redirected back to /dashboard ("Maximum update
        // depth exceeded" infinite loop). A hard navigation re-mounts
        // the app so AuthProvider performs its initial /auth/me fetch
        // with the new session cookie.
        const target =
          data.user && !data.user.firstLoginCompleted
            ? "wachtwoord-wijzigen"
            : "dashboard";
        const base = import.meta.env.BASE_URL.endsWith("/")
          ? import.meta.env.BASE_URL
          : `${import.meta.env.BASE_URL}/`;
        window.location.assign(`${base}${target}`);
      },
    });
  };

  if (sessionLoading) {
    return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (session?.user) {
    return <Redirect to={session.user.firstLoginCompleted ? "/dashboard" : "/wachtwoord-wijzigen"} />;
  }

  return (
    <div className="min-h-screen flex w-full bg-background relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-[40vh] bg-primary/5 rounded-b-[100px] -z-10 transform -skew-y-2"></div>
      
      <div className="w-full flex items-center justify-center p-4">
        <div className="w-full max-w-[1000px] flex flex-col md:flex-row gap-8 lg:gap-16 items-center">
          
          <div className="flex-1 max-w-md w-full">
            <div className="mb-8 flex items-center gap-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
                <Building2 className="w-6 h-6" />
              </div>
              <h1 className="font-serif text-3xl font-bold text-foreground tracking-tight">Geenbank Hub</h1>
            </div>
            
            <Card className="w-full shadow-xl border-primary/10">
              <CardHeader className="space-y-1 pb-6">
                <CardTitle className="text-2xl font-semibold tracking-tight">Welkom terug</CardTitle>
                <CardDescription className="text-muted-foreground text-sm">
                  Log in op uw account om verder te gaan
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                  {loginMutation.isError && (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription>Ongeldige inloggegevens. Probeer het opnieuw.</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mailadres</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="naam@bedrijf.nl" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-11"
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Wachtwoord</Label>
                    </div>
                    <Input 
                      id="password" 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="h-11"
                      data-testid="input-password"
                    />
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-6">
                  <Button 
                    type="submit" 
                    className="w-full h-11 text-base font-medium" 
                    disabled={loginMutation.isPending}
                    data-testid="button-login"
                  >
                    {loginMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Inloggen"}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </div>

          <div className="flex-1 w-full max-w-md">
            <Card className="bg-secondary/50 border-secondary-border">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Info className="w-4 h-4" />
                  Demo Authenticatie
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Ondernemer (Prospect)</p>
                  <p className="text-muted-foreground font-mono bg-background p-1 px-2 rounded border">anne@brouwerij-noord.nl / Welkom2025!</p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Kredietbeoordelaar (Loan Officer)</p>
                  <p className="text-muted-foreground font-mono bg-background p-1 px-2 rounded border">maarten@geenbank.nl / Welkom2025!</p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Systeembeheerder (Admin)</p>
                  <p className="text-muted-foreground font-mono bg-background p-1 px-2 rounded border">admin@geenbank.nl / Welkom2025!</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
