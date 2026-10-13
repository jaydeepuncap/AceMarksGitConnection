import { useNavigateHandler } from '../lib/hooks';
import type { ApiClientError } from '../lib/api-client';

const HINTS: Partial<Record<string, string>> = {
  GITHUB_NOT_CONNECTED: 'Connect a GitHub account in Settings to continue.',
  GITHUB_AUTH_FAILED: 'The saved GitHub token was rejected. Reconnect GitHub in Settings with a new token.',
  GITHUB_ACCESS_DENIED: 'Give the token "Contents: Read-only" and "Metadata: Read-only" access to this repository.',
  GITHUB_NOT_FOUND: 'The repository, branch, commit or file was not found — or the token cannot see it.',
  GITHUB_RATE_LIMITED: 'GitHub rate limit reached. Wait a moment and try again.',
  THEME_WRITE_NOT_PERMITTED:
    'Shopify requires an approved theme-modification exemption (plus write_themes) before apps can edit theme files.',
  SHOPIFY_REAUTH_REQUIRED: 'Reload the app from Shopify Admin to re-authorize it.',
  RATE_LIMITED: 'Too many requests. Wait a few seconds and try again.',
  PREVIEW_EXPIRED: 'Previews are valid for 30 minutes. Generate a new preview.',
  SERVER_MISCONFIGURED:
    'The app server is missing required secrets. An administrator must set them with `wrangler secret put` and redeploy.',
  DATABASE_NOT_MIGRATED:
    'The app database has not been initialised. An administrator must run `npm run db:migrate:remote`.',
};

interface Props {
  error: ApiClientError | Error | null;
  heading?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/** Critical <s-banner> for API errors with a code-specific hint and optional actions. */
export function ErrorBanner({ error, heading = 'Something went wrong', onRetry, onDismiss }: Props) {
  const go = useNavigateHandler();
  if (!error) return null;
  const code = 'code' in error ? (error as ApiClientError).code : undefined;
  const requestId = 'requestId' in error ? (error as ApiClientError).requestId : undefined;
  const hint = code ? HINTS[code] : undefined;
  const needsSettings = code === 'GITHUB_NOT_CONNECTED' || code === 'GITHUB_AUTH_FAILED';

  return (
    <s-banner tone="critical" heading={heading} dismissible={!!onDismiss} onDismiss={onDismiss}>
      <s-paragraph>{error.message}</s-paragraph>
      {hint && <s-paragraph>{hint}</s-paragraph>}
      {requestId && (
        <s-paragraph color="subdued">
          <s-text color="subdued">Request ID: {requestId}</s-text>
        </s-paragraph>
      )}
      {onRetry && (
        <s-button slot="secondary-actions" onClick={onRetry}>
          Try again
        </s-button>
      )}
      {needsSettings && (
        <s-button slot="secondary-actions" onClick={go('/settings')}>
          Open settings
        </s-button>
      )}
    </s-banner>
  );
}
