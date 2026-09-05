import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  const isGitHubPages = import.meta.env.BASE_URL !== "/";
  const base = isGitHubPages ? "" : import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <WouterRouter hook={isGitHubPages ? useHashLocation : undefined} base={base}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/review" component={Home} />
        <Route path="/generate" component={Home} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
