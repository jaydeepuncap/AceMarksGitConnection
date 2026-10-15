import { useNavigateHandler } from '../lib/hooks';
import type { ApiClientError } from '../lib/api-client';
import { Banner, Button, Paragraph, Text } from './ui';

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

/**
 * Codes that are not errors but something to know (info) or to act on
 * (warning): shown in a calmer banner without a request ID.
 */
const NOTICES: Partial<Record<string, { tone: 'info' | 'warning'; heading: string; hint?: string }>> = {
  ALREADY_SYNCED: {
    tone: 'info',
    heading: 'Already up to date',
    hint: 'Select a newer commit, or choose Push: "Only the selected commit" to push this commit\'s files again.',
  },
  PREVIEW_EXPIRED: { tone: 'warning', heading: 'Preview expired' },
  RATE_LIMITED: { tone: 'warning', heading: 'Please wait a moment' },
  GITHUB_RATE_LIMITED: { tone: 'warning', heading: 'GitHub is busy' },
  DIRECT_EDITS_FOUND: { tone: 'warning', heading: 'Files were edited directly in Shopify' },
};

interface Props {
  error: ApiClientError | Error | null;
  heading?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/** <Banner> for API errors (critical) and notices (info / warning) with a code-specific hint and optional actions. */
export function ErrorBanner({ error, heading = 'Something went wrong', onRetry, onDismiss }: Props) {
  const go = useNavigateHandler();
  if (!error) return null;
  const code = 'code' in error ? (error as ApiClientError).code : undefined;
  const requestId = 'requestId' in error ? (error as ApiClientError).requestId : undefined;
  const hint = code ? HINTS[code] : undefined;
  const needsSettings = code === 'GITHUB_NOT_CONNECTED' || code === 'GITHUB_AUTH_FAILED';
  const notice = code ? NOTICES[code] : undefined;

  return (
    <Banner
      tone={notice?.tone ?? 'critical'}
      heading={notice?.heading ?? heading}
      dismissible={!!onDismiss}
      onDismiss={onDismiss}
    >
      <Paragraph>{error.message}</Paragraph>
      {(notice?.hint ?? hint) && <Paragraph>{notice?.hint ?? hint}</Paragraph>}
      {requestId && !notice && (
        <Paragraph color="subdued">
          <Text color="subdued">Request ID: {requestId}</Text>
        </Paragraph>
      )}
      {onRetry && (
        <Button slot="secondary-actions" onClick={onRetry}>
          Try again
        </Button>
      )}
      {needsSettings && (
        <Button slot="secondary-actions" onClick={go('/settings')}>
          Open settings
        </Button>
      )}
    </Banner>
  );
}
