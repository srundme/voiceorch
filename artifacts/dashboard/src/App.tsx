import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";

// Components
import { Layout } from "@/components/layout";

// Pages
import AssistantsPage from "@/pages/assistants";
import Dashboard from "@/pages/dashboard";
import AgentsList from "@/pages/agents/index";
import AgentNew from "@/pages/agents/new";
import AgentDetail from "@/pages/agents/[id]";
import AgentEdit from "@/pages/agents/edit";
import CallsList from "@/pages/calls/index";
import CallDetail from "@/pages/calls/[id]";
import ProvidersList from "@/pages/providers/index";
import Settings from "@/pages/settings/index";
import KnowledgeBasePage from "@/pages/knowledge-base";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={AssistantsPage} />
        <Route path="/analytics" component={Dashboard} />
        <Route path="/agents" component={AgentsList} />
        <Route path="/agents/new" component={AgentNew} />
        <Route path="/agents/:id/edit" component={AgentEdit} />
        <Route path="/agents/:id" component={AgentDetail} />
        <Route path="/calls" component={CallsList} />
        <Route path="/calls/:id" component={CallDetail} />
        <Route path="/knowledge-bases" component={KnowledgeBasePage} />
        <Route path="/providers" component={ProvidersList} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
