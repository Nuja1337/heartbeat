import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { scheduleRetention } from '../data/retention';
import { Shell } from './layout/Shell';
import { Home } from './pages/Home';
import { ModuleSetup } from './pages/ModuleSetup';
import { PlayScreen } from './pages/PlayScreen';
import { PlaySetup } from './pages/PlaySetup';
import { Results } from './pages/Results';
import { Settings } from './pages/Settings';
import { Train } from './pages/Train';
import { Bests } from './pages/stats/Bests';
import { History } from './pages/stats/History';
import { StatsLayout } from './pages/stats/Layout';
import { Overview } from './pages/stats/Overview';
import { Patterns } from './pages/stats/Patterns';
import { PlayDetail } from './pages/stats/PlayDetail';
import { Timing } from './pages/stats/Timing';
import { Trends } from './pages/stats/Trends';
import { boot, useAppState } from './state/store';
import { invalidateAnalysis } from './state/analysis';

function NotFound() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-2">
        There is nothing at this address. <Link to="/" className="text-accent hover:underline">Go home</Link>.
      </p>
    </div>
  );
}

export function App() {
  const { ready } = useAppState();

  useEffect(() => {
    void boot().then(() => scheduleRetention((removed) => removed > 0 && invalidateAnalysis()));
  }, []);

  if (!ready) return <div className="min-h-screen bg-bg" aria-busy="true" />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/session" element={<PlayScreen />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="play" element={<PlaySetup />} />
          <Route path="train" element={<Train />} />
          <Route path="train/:mode" element={<ModuleSetup />} />
          <Route path="results/:id" element={<Results />} />
          <Route path="settings" element={<Settings />} />
          <Route path="stats" element={<StatsLayout />}>
            <Route index element={<Overview />} />
            <Route path="trends" element={<Trends />} />
            <Route path="patterns" element={<Patterns />} />
            <Route path="timing" element={<Timing />} />
            <Route path="bests" element={<Bests />} />
            <Route path="history" element={<History />} />
            <Route path="play/:id" element={<PlayDetail />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
