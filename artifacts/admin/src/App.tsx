import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Overview from "@/pages/overview";
import UsersList from "@/pages/users";
import UserDetail from "@/pages/user-detail";
import Finance from "@/pages/finance";
import Platform from "@/pages/platform";
import Growth from "@/pages/growth";
import ManagedKeys from "@/pages/managed-keys";
import Voices from "@/pages/voices";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, ...rest }: { component: any; path?: string }) {
  const token = localStorage.getItem("adminToken");
  
  if (!token) {
    window.location.href = `${import.meta.env.BASE_URL}login`;
    return null;
  }

  return (
    <Route {...rest}>
      {(params) => (
        <Layout>
          <Component params={params} />
        </Layout>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <ProtectedRoute path="/" component={Overview} />
      <ProtectedRoute path="/users" component={UsersList} />
      <ProtectedRoute path="/users/:clerkId" component={UserDetail} />
      <ProtectedRoute path="/finance" component={Finance} />
      <ProtectedRoute path="/platform" component={Platform} />
      <ProtectedRoute path="/growth" component={Growth} />
      <ProtectedRoute path="/managed-keys" component={ManagedKeys} />
      <ProtectedRoute path="/voices" component={Voices} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
