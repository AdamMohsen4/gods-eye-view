import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Header, TabBar } from './components/Header.tsx';
import { IconClose } from './components/icons.tsx';
import { InviteToast } from './components/InviteToast.tsx';
import { Home } from './screens/Home.tsx';
import { MapPage, MapsPage } from './screens/MapsPage.tsx';
import { ChallengePage } from './screens/ChallengePage.tsx';
import { ProfilePage } from './screens/ProfilePage.tsx';
import { LeaderboardsPage } from './screens/LeaderboardsPage.tsx';

// Screens with a map or panorama load MapLibre on demand, keeping the first page light.
const GamePage = lazy(() => import('./screens/GamePage.tsx').then((m) => ({ default: m.GamePage })));
const DuelsPage = lazy(() => import('./screens/DuelsPage.tsx').then((m) => ({ default: m.DuelsPage })));
const PartyPage = lazy(() => import('./screens/PartyPage.tsx').then((m) => ({ default: m.PartyPage })));
const MakerList = lazy(() => import('./screens/MakerPages.tsx').then((m) => ({ default: m.MakerList })));
const MakerEdit = lazy(() => import('./screens/MakerPages.tsx').then((m) => ({ default: m.MakerEdit })));

function Shell() {
  const loc = useLocation();
  // Full-screen play views hide the site header.
  const immersive = /^\/(game|create\/[^/]+$)/.test(loc.pathname);
  return (
    <div className={immersive ? 'shell immersive' : 'shell'}>
      {!immersive && <Header />}
      {immersive && (
        <Link to="/" className="home-btn btn btn-glass" aria-label="Leave to home">
          <IconClose />
        </Link>
      )}
      <main>
        <Suspense fallback={<div className="page center muted">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/maps" element={<MapsPage />} />
          <Route path="/maps/:slug" element={<MapPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/daily" element={<ChallengePage daily />} />
          <Route path="/challenge/:token" element={<ChallengePage />} />
          <Route path="/duels" element={<DuelsPage />} />
          <Route path="/party" element={<PartyPage />} />
          <Route path="/party/:code" element={<PartyPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/create" element={<MakerList />} />
          <Route path="/create/:id" element={<MakerEdit />} />
          <Route path="/leaderboards" element={<LeaderboardsPage />} />
          <Route
            path="*"
            element={
              <div className="page center lost">
                <h1 className="display-sm">Off the map</h1>
                <p className="muted">There’s no page at this address. It may have moved, or the link was cut short.</p>
                <div className="actions">
                  <Link className="btn btn-primary" to="/">
                    Back to Earthnow
                  </Link>
                  <Link className="btn" to="/maps">
                    Browse maps
                  </Link>
                </div>
              </div>
            }
          />
        </Routes>
        </Suspense>
      </main>
      {!immersive && <TabBar />}
      {!/^\/(game|party)/.test(loc.pathname) && <InviteToast />}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
