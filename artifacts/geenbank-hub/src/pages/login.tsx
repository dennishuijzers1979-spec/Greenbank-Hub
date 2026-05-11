import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLogin, useGetCurrentUser } from "@workspace/api-client-react";
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
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: session, isLoading: sessionLoading } = useGetCurrentUser();
  const loginMutation = useLogin();
  const hasRedirectedRef = useRef(false);

  const userId = session?.user?.id ?? null;
  const firstLoginCompleted = session?.user?.firstLoginCompleted ?? null;

  useEffect(() => {
    if (sessionLoading) return;
    if (!userId) return;
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    if (firstLoginCompleted === false) {
      setLocation("/wachtwoord-wijzigen");
    } else {
      setLocation("/dashboard");
    }
    // setLocation from wouter is recreated each render; depending on it would
    // re-fire this effect every render and (combined with the pushState it
    // performs) cause an infinite update loop. Key off stable primitive
    // user fields and rely on the ref-guard to ensure a single redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, userId, firstLoginCompleted]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { email, password } }, {
      onSuccess: (data) => {
        queryClient.setQueryData(["/api/auth/me"], data);
        hasRedirectedRef.current = true;
        if (data.user && !data.user.firstLoginCompleted) {
          setLocation("/wachtwoord-wijzigen");
        } else {
          setLocation("/dashboard");
        }
      }
    });
  };

  if (sessionLoading) {
    return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
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