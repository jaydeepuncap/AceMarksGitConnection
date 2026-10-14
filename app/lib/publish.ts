import { useNavigate } from 'react-router-dom';
import { api } from './api-client';
import { useMutation } from './hooks';

/**
 * Starts "Publish to Live" for a Staging-verified update: the server checks the
 * update and plans it, then the review page opens. Without a theme ID the Live
 * theme from Settings is used.
 */
export function usePublishFromStaging() {
  const navigate = useNavigate();
  const plan = useMutation((targetSha: string, themeId?: string) => api.updates.plan({ kind: 'publish', targetSha, themeId }));
  const start = async (targetSha: string, themeId?: string) => {
    const run = await plan.run(targetSha, themeId);
    if (run) navigate(`/updates/${run.id}`);
  };
  return { start, pending: plan.pending, error: plan.error, clearError: plan.clearError };
}
