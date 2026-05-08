import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

// Pages
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";
import DossierHub from "@/pages/dossier/index";
import IntakeWizard from "@/pages/dossier/intake";
import DocumentenUpload from "@/pages/dossier/documenten";
import Rapportage from "@/pages/dossier/rapport";
import LoanOfficerQueue from "@/pages/dossiers/index";
import DossierDetail from "@/pages/dossiers/[id]";
import PartnersAdmin from "@/pages/partners/index";
import AdminDashboard from "@/pages/admin/index";
import Activiteit from "@/pages/activiteit/index";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/wachtwoord-wijzigen">
        <ProtectedRoute>
          <ChangePassword />
        </ProtectedRoute>
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute>
          <Shell><Dashboard /></Shell>
        </ProtectedRoute>
      </Route>
      
      {/* Prospect Routes */}
      <Route path="/dossier">
        <ProtectedRoute>
          <Shell><DossierHub /></Shell>
        </ProtectedRoute>
      </Route>
      <Route path="/dossier/intake">
        <ProtectedRoute>
          <Shell><IntakeWizard /></Shell>
        </ProtectedRoute>
      </Route>
      <Route path="/dossier/documenten">
        <ProtectedRoute>
          <Shell><DocumentenUpload /></Shell>
        </ProtectedRoute>
      </Route>
      <Route path="/dossier/rapport">
        <ProtectedRoute>
          <Shell><Rapportage /></Shell>
        </ProtectedRoute>
      </Route>
      
      {/* Loan Officer Routes */}
      <Route path="/dossiers">
        <ProtectedRoute>
          <Shell><LoanOfficerQueue /></Shell>
        </ProtectedRoute>
      </Route>
      <Route path="/dossiers/:id">
        <ProtectedRoute>
          <Shell><DossierDetail /></Shell>
        </ProtectedRoute>
      </Route>

      {/* Admin Routes */}
      <Route path="/partners">
        <ProtectedRoute>
          <Shell><PartnersAdmin /></Shell>
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute>
          <Shell><AdminDashboard /></Shell>
        </ProtectedRoute>
      </Route>
      <Route path="/activiteit">
        <ProtectedRoute>
          <Shell><Activiteit /></Shell>
        </ProtectedRoute>
      </Route>

      {/* Defaults */}
      <Route path="/">
        <ProtectedRoute>
          <Shell><Dashboard /></Shell>
        </ProtectedRoute>
      </Route>
      <Route>
        <ProtectedRoute>
          <Shell><NotFound /></Shell>
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="geenbank-theme">
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
