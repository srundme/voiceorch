import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProgressStore } from "@/hooks/use-progress";
import NotFound from "@/pages/not-found";

// Pages
import Home from "@/pages/Home";
import ModuleOverview from "@/pages/ModuleOverview";
import ChapterReader from "@/pages/ChapterReader";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/module/:slug" component={ModuleOverview} />
      <Route path="/chapter/:slug" component={ChapterReader} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const initializeProgress = useProgressStore((s) => s.initializeProgress);

  useEffect(() => {
    void initializeProgress();
  }, [initializeProgress]);

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
