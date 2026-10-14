import { useEffect } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { NavMenu } from '@shopify/app-bridge-react';
import History from './routes/History';
import Rollout from './routes/Rollout';
import Settings from './routes/Settings';
import ThemeDetail from './routes/ThemeDetail';
import Themes from './routes/Themes';
import UpdateRun from './routes/UpdateRun';
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
    <s-page heading="Theme Sync">
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
          Themes
        </Link>
        <Link to="/themes">Themes</Link>
        <Link to="/rollout">Roll out</Link>
        <Link to="/history">Update history</Link>
        <Link to="/settings">Settings</Link>
      </NavMenu>
      <Routes>
        <Route path="/" element={<Themes />} />
        <Route path="/themes" element={<Themes />} />
        <Route path="/themes/:id" element={<ThemeDetail />} />
        <Route path="/updates/:id" element={<UpdateRun />} />
        <Route path="/rollout" element={<Rollout />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Themes />} />
      </Routes>
    </>
  );
}
