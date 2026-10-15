import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';

/**
 * Commit sync now lives on each mapping's page. Old links (/commits?branch=…
 * or ?themeId=…) open that mapping, or the mapping list.
 */
export default function CommitsRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useEffect(() => {
    const branch = params.get('branch');
    const themeId = params.get('themeId');
    api.mappings
      .list()
      .then(({ items }) => {
        const match = items.find((m) => (themeId && m.themeId === themeId) || (branch && m.branch === branch));
        navigate(match ? `/mappings/${match.id}` : '/mappings', { replace: true });
      })
      .catch(() => navigate('/mappings', { replace: true }));
  }, [navigate, params]);
  return <LoadingState title="Theme mapping" />;
}
