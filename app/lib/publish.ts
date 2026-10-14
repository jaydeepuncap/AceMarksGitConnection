import { useNavigate } from 'react-router-dom';
import { api } from './api-client';
import { useMutation } from './hooks';

/**
 * Starts "Publish to Live" for an update that fully completed on an unpublished
 * (test) theme: the server checks it and plans it, then the review page opens.
 * Without a theme ID the published theme is used.
 */
export function usePublishToLive() {
  const navigate = useNavigate();
  const plan = useMutation((targetSha: string, themeId?: string) => api.updates.plan({ kind: 'publish', targetSha, themeId }));
  const start = async (targetSha: string, themeId?: string) => {
    const run = await plan.run(targetSha, themeId);
    if (run) navigate(`/updates/${run.id}`);
  };
  return { start, pending: plan.pending, error: plan.error, clearError: plan.clearError };
}
