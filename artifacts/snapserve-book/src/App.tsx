import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProgressStore } from "@/hooks/use-progress";
import { GlobalNav } from "@/components/GlobalNav";
import NotFound from "@/pages/not-found";

// Pages
import Home from "@/pages/Home";
import ModuleOverview from "@/pages/ModuleOverview";
import ChapterReader from "@/pages/ChapterReader";
import Exam from "@/pages/Exam";
import Search from "@/pages/Search";
import Glossary from "@/pages/Glossary";
import CheatSheet from "@/pages/CheatSheet";
import ArchitectureMap from "@/pages/ArchitectureMap";
import Certificate from "@/pages/Certificate";
import Bookmarks from "@/pages/Bookmarks";
import FileExplorer from "@/pages/FileExplorer";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/module/:slug" component={ModuleOverview} />
      <Route path="/chapter/:slug" component={ChapterReader} />
      <Route path="/exam" component={Exam} />
      <Route path="/search" component={Search} />
      <Route path="/glossary" component={Glossary} />
      <Route path="/cheatsheet" component={CheatSheet} />
      <Route path="/architecture" component={ArchitectureMap} />
      <Route path="/certificate" component={Certificate} />
      <Route path="/bookmarks" component={Bookmarks} />
      <Route path="/files" component={FileExplorer} />
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
          <GlobalNav />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
