import { useState } from 'react';
import { useLocation } from 'wouter';
import { BarChart3, ShieldAlert } from 'lucide-react';
import { useDemoLogin } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { errMsg, usePageMeta } from '@/lib/arus';

export default function Login() {
  usePageMeta('Demo entry', 'Demo administrator entry for Arus. Not production authentication.');
  const [, setLoc] = useLocation();
  const login = useDemoLogin();
  const [err, setErr] = useState('');
  const enter = async () => {
    setErr('');
    try {
      await login.mutateAsync();
      setLoc('/');
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <div className="grid min-h-[100dvh] md:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white md:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500"><BarChart3 className="h-5 w-5" /></div>
          <span className="text-2xl font-semibold tracking-wide">Arus</span>
        </div>
        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.25em] text-orange-400">Arus ·</p>
          <h1 className="max-w-md text-4xl font-semibold leading-tight">Know which invoice to chase first, and why.</h1>
          <p className="mt-4 max-w-md text-sm text-sidebar-foreground">
            SME receivables risk monitoring and an explainable four-factor collection scheduler. Every plan waits for a human approval.
          </p>
        </div>
        <svg viewBox="0 0 400 80" className="w-full max-w-md opacity-60" aria-hidden>
          <path d="M0 60 C40 10 80 70 120 40 S200 5 240 35 320 70 400 15" fill="none" stroke="hsl(24 92% 54%)" strokeWidth="2" />
          <path d="M0 70 C50 40 90 75 140 55 S220 30 260 50 340 60 400 40" fill="none" stroke="hsl(214 30% 62%)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-semibold">Merchant Finance Admin</h2>
            <p className="text-sm text-muted-foreground">Administrator entry · Demo</p>
          </div>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Demo mode, not secure authentication</AlertTitle>
            <AlertDescription>
              There is no password or production identity check. All data is synthetic, amounts are in MYR, and no real notices or transactions occur.
            </AlertDescription>
          </Alert>
          {err && <Alert variant="destructive" data-testid="alert-login-error"><AlertDescription>{err}</AlertDescription></Alert>}
          <Button className="w-full" size="lg" onClick={enter} disabled={login.isPending} data-testid="button-demo-login">
            {login.isPending ? 'Entering...' : 'Enter as Demo Admin'}
          </Button>
        </div>
      </div>
    </div>
  );
}
