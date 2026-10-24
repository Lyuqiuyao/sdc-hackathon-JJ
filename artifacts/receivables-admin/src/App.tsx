import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Shell } from '@/components/shell';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Receivables from '@/pages/receivables';
import Customers from '@/pages/customers';
import SedgInformation from '@/pages/esg-documents';
import RiskTriggers from '@/pages/risk-triggers';
import AiPlanner from '@/pages/ai-planner';
import Approvals from '@/pages/approvals';
import ExecutionResults from '@/pages/execution-results';
import AuditLogs from '@/pages/audit-logs';
import Settings from '@/pages/settings';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

function Router() {
  const [location] = useLocation();
  const routes = (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/receivables" component={Receivables} />
        <Route path="/customers" component={Customers} />
        <Route path="/sedg-information" component={SedgInformation} />
        <Route path="/esg-documents" component={SedgInformation} />
        <Route path="/risk-triggers" component={RiskTriggers} />
        <Route path="/ai-planner" component={AiPlanner} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/execution-results" component={ExecutionResults} />
        <Route path="/audit-logs" component={AuditLogs} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
  if (location === '/login') return <Login />;
  return <Shell>{routes as ReactNode}</Shell>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
