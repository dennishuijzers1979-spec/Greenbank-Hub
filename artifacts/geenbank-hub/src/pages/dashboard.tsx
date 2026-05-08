import { useAuth } from "@/lib/auth";
import ProspectDashboard from "@/components/dashboard/ProspectDashboard";
import LoanOfficerDashboard from "@/components/dashboard/LoanOfficerDashboard";
import { Loader2 } from "lucide-react";

export default function Dashboard() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const role = session?.user?.role;

  if (role === "prospect") {
    return <ProspectDashboard />;
  }

  if (role === "loan_officer" || role === "admin") {
    return <LoanOfficerDashboard />;
  }

  return <div>Unknown role</div>;
}