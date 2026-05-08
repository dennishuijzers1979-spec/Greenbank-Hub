import React, { createContext, useContext, useEffect } from "react";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { AuthSession } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  session: AuthSession | null;
  isLoading: boolean;
  isError: boolean;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  isError: false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session, isLoading, isError } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    }
  });

  return (
    <AuthContext.Provider value={{ session: session ?? null, isLoading, isError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && (!session || !session.user)) {
      setLocation("/login");
    } else if (!isLoading && session?.user && !session.user.firstLoginCompleted && location !== "/wachtwoord-wijzigen") {
      setLocation("/wachtwoord-wijzigen");
    }
  }, [isLoading, session, location, setLocation]);

  if (isLoading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent"></div></div>;
  }

  if (!session || !session.user) {
    return null;
  }

  if (!session.user.firstLoginCompleted && location !== "/wachtwoord-wijzigen") {
    return null;
  }

  return <>{children}</>;
};