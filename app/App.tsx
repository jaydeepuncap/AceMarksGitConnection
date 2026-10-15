import { useEffect } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { NavMenu } from '@shopify/app-bridge-react';
import Dashboard from './routes/Dashboard';
import Settings from './routes/Settings';
import Repositories from './routes/Repositories';
import Themes from './routes/Themes';
import ThemeMapping from './routes/ThemeMapping';
import CommitsRedirect from './routes/CommitsRedirect';
import MappingDetail from './routes/MappingDetail';
import SyncHistory from './routes/SyncHistory';
import { isEmbedded } from './lib/app-bridge';

/**
 * Keeps React Router in charge of navigation when App Bridge handles a click on
 * an Admin nav item: App Bridge dispatches `shopify:navigate` on the link.
 */
function useAppBridgeNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (event: Event) => {
      const href = (event.target as HTMLElement | null)?.getAttribute('href');
      if (href && href.startsWith('/')) navigate(href);
    };
    document.addEventListener('shopify:navigate', handler);
    return () => document.removeEventListener('shopify:navigate', handler);
  }, [navigate]);
}

function NotEmbedded() {
  return (
    <s-page heading="Ace Marks Git Connection">
      <s-banner tone="warning" heading="Open this app from Shopify Admin">
        <s-paragraph>
          This is an embedded Shopify app. Open it from your store's Apps section so it can authenticate securely.
        </s-paragraph>
      </s-banner>
    </s-page>
  );
}

export default function App() {
  useAppBridgeNavigation();
  if (!isEmbedded()) return <NotEmbedded />;

  return (
    <>
      <NavMenu>
        <Link to="/" rel="home">
          Dashboard
        </Link>
        <Link to="/mappings">Theme mapping</Link>
        <Link to="/sync-history">Sync history</Link>
        <Link to="/themes">Themes</Link>
        <Link to="/repositories">Repositories</Link>
        <Link to="/settings">Settings</Link>
      </NavMenu>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/repositories" element={<Repositories />} />
        <Route path="/themes" element={<Themes />} />
        <Route path="/mappings" element={<ThemeMapping />} />
        <Route path="/mappings/:id" element={<MappingDetail />} />
        <Route path="/commits" element={<CommitsRedirect />} />
        <Route path="/sync-history" element={<SyncHistory />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </>
  );
}
