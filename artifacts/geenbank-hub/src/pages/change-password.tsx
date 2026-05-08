import { useState } from "react";
import { useLocation } from "wouter";
import { useChangePassword, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const changePasswordMutation = useChangePassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Nieuwe wachtwoorden komen niet overeen.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Nieuw wachtwoord moet minimaal 8 tekens lang zijn.");
      return;
    }

    changePasswordMutation.mutate({ data: { currentPassword, newPassword } }, {
      onSuccess: () => {
        // Refetch user to update firstLoginCompleted status
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setLocation("/dashboard");
      },
      onError: () => {
        setError("Wachtwoord wijzigen mislukt. Controleer uw huidige wachtwoord.");
      }
    });
  };

  return (
    <div className="min-h-screen flex w-full bg-background items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="space-y-2 pb-6">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-2 mx-auto">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight text-center">Welkom bij Geenbank Hub</CardTitle>
          <CardDescription className="text-center">
            Voor uw veiligheid dient u uw tijdelijke wachtwoord te wijzigen voordat u verder kunt gaan.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" className="py-2">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Huidig Wachtwoord</Label>
              <Input 
                id="currentPassword" 
                type="password" 
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nieuw Wachtwoord</Label>
              <Input 
                id="newPassword" 
                type="password" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Bevestig Nieuw Wachtwoord</Label>
              <Input 
                id="confirmPassword" 
                type="password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                data-testid="input-confirm-password"
              />
            </div>
          </CardContent>
          <CardFooter className="pt-4 pb-6">
            <Button 
              type="submit" 
              className="w-full" 
              disabled={changePasswordMutation.isPending}
              data-testid="button-change-password"
            >
              {changePasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Wachtwoord Opslaan
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}