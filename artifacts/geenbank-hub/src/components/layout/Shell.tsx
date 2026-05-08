import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme-provider";
import { useLogout } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogOut, User, Moon, Sun, Home, FileText, Activity, Users, Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function Shell({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const { theme, setTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  const user = session?.user;
  const isProspect = user?.role === "prospect";
  const isLoanOfficer = user?.role === "loan_officer";
  const isAdmin = user?.role === "admin";

  const navItems = [];

  if (isProspect) {
    navItems.push({ label: "Dashboard", href: "/dashboard", icon: Home });
    navItems.push({ label: "Mijn Dossier", href: "/dossier", icon: FileText });
  }

  if (isLoanOfficer || isAdmin) {
    navItems.push({ label: "Dashboard", href: "/dashboard", icon: Home });
    navItems.push({ label: "Dossiers", href: "/dossiers", icon: FileText });
    navItems.push({ label: "Activiteit", href: "/activiteit", icon: Activity });
  }

  if (isAdmin) {
    navItems.push({ label: "Partners", href: "/partners", icon: Users });
    navItems.push({ label: "Systeem", href: "/admin", icon: Settings });
  }

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-sidebar flex-shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b">
          <div className="font-serif font-bold text-xl tracking-tight text-sidebar-primary">Geenbank Hub</div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t space-y-4">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <User className="w-4 h-4" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user?.displayName || user?.email}</span>
              <span className="text-xs text-muted-foreground capitalize">{user?.role.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-3">
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="h-8 w-8 text-muted-foreground" data-testid="button-toggle-theme">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="h-8 text-muted-foreground hover:text-destructive" data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Log uit
            </Button>
          </div>
        </div>
      </aside>
      
      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}