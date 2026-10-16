import { useCallback } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { firstLine, formatDate, SYNC_STATUS_BADGE } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import {
  Badge,
  Button,
  Grid,
  IndexTable,
  IndexTableCell,
  IndexTableRow,
  Paragraph,
  Section,
  Stack,
  Text,
} from '../components/ui';

export default function Dashboard() {
  const go = useNavigateHandler();
  const load = useCallback(
    () =>
      Promise.all([api.settings.get(), api.github.connection(), api.sync.history({ perPage: 5 }), api.mappings.list()]),
    [],
  );
  const { data, error, loading, reload } = useApiQuery(load, []);

  if (loading && !data) return <LoadingState title="Dashboard" />;

  const [settingsRes, github, history, mappingsRes] = data ?? [null, null, null, null];
  const mappings = mappingsRes?.items ?? [];
  const shop = settingsRes?.shop;
  const settings = settingsRes?.settings;

  return (
    <AppLayout
      title="Dashboard"
      primaryAction={{ content: 'Theme mapping', onAction: go('/mappings'), disabled: !github?.connected }}
      banners={<ErrorBanner error={error} onRetry={reload} />}
    >
      <Grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
        <Section heading="Shopify store">
          <Stack gap="small-200">
            <Stack direction="inline" gap="small-200" alignItems="center">
              <Text type="strong">{shop?.shopDomain ?? '—'}</Text>
              {shop && (
                <Badge tone={shop.status === 'installed' ? 'success' : 'critical'}>
                  {shop.status === 'installed' ? 'Connected' : 'Not installed'}
                </Badge>
              )}
            </Stack>
            <Stack direction="inline" gap="small-200">
              <Badge tone={shop?.canReadThemes ? 'success' : 'critical'}>
                {shop?.canReadThemes ? 'Can read themes' : 'Missing read_themes'}
              </Badge>
              <Badge tone={shop?.canWriteThemes ? 'success' : 'warning'}>
                {shop?.canWriteThemes ? 'Can write themes' : 'Missing write_themes'}
              </Badge>
            </Stack>
          </Stack>
        </Section>

        <Section heading="GitHub">
          <Stack gap="small-200">
            <Stack direction="inline" gap="small-200" alignItems="center">
              <Badge tone={github?.connected ? 'success' : 'caution'}>
                {github?.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </Stack>
            <Paragraph>
              {github?.connection
                ? `Signed in as ${github.connection.accountLogin}`
                : 'Add a personal access token in Settings.'}
            </Paragraph>
            {!github?.connected && (
              <Stack direction="inline">
                <Button onClick={go('/settings')}>Connect GitHub</Button>
              </Stack>
            )}
          </Stack>
        </Section>

        <Section heading="Repository">
          <Stack gap="small-200">
            <Text type="strong">{settings?.defaultRepository ?? 'No repository selected'}</Text>
            <Text color="subdued">
              {settings?.defaultRepository
                ? `${mappings.filter((m) => m.repository.toLowerCase() === settings.defaultRepository!.toLowerCase()).length} branch(es) mapped to themes`
                : 'Choose the repository to sync from in Settings.'}
            </Text>
            <Stack direction="inline">
              <Button onClick={go('/settings')} disabled={!github?.connected}>
                {settings?.defaultRepository ? 'Change in Settings' : 'Choose repository'}
              </Button>
            </Stack>
          </Stack>
        </Section>

        <Section heading="Theme mappings">
          <Stack gap="small-200">
            {github && !github.connected ? (
              <Text color="subdued">
                {mappings.length === 0
                  ? 'Connect GitHub to map branches to themes.'
                  : `${mappings.length} mapping(s) paused until GitHub is connected again.`}
              </Text>
            ) : mappings.length === 0 ? (
              <Text color="subdued">No branch is mapped to a theme yet.</Text>
            ) : (
              mappings.slice(0, 4).map((m) => (
                <Button key={m.id} variant="tertiary" onClick={go(`/mappings/${m.id}`)}>
                  {`${m.branch} → ${m.themeName}`}
                </Button>
              ))
            )}
            {mappings.length > 4 && <Text color="subdued">{`and ${mappings.length - 4} more`}</Text>}
            <Stack direction="inline">
              <Button onClick={go('/mappings')} disabled={!github?.connected}>
                {mappings.length === 0 ? 'Map a branch to a theme' : 'Manage mappings'}
              </Button>
            </Stack>
          </Stack>
        </Section>
      </Grid>

      <Section heading="Recent synchronizations">
        <Button slot="secondary-actions" variant="tertiary" onClick={go('/sync-history')}>
          View all
        </Button>
        {history && history.items.length === 0 ? (
          <Paragraph color="subdued">No syncs yet. Pick a commit to preview your first sync.</Paragraph>
        ) : (
          <IndexTable
            variant="auto"
            columns={[
              { title: 'Commit → theme', listSlot: 'primary' },
              { title: 'Started', listSlot: 'secondary' },
              { title: 'Status', listSlot: 'inline' },
              { title: 'Details' },
            ]}
            rows={history?.items.map((run) => (
              <IndexTableRow key={run.id}>
                <IndexTableCell>
                  <Stack gap="none">
                    <Text type="strong">
                      {run.commitSha.slice(0, 7)} → {run.themeName}
                    </Text>
                    <Text color="subdued">{firstLine(run.commitMessage)}</Text>
                  </Stack>
                </IndexTableCell>
                <IndexTableCell>{formatDate(run.initiatedAt)}</IndexTableCell>
                <IndexTableCell>
                  <Badge tone={SYNC_STATUS_BADGE[run.status].tone}>{SYNC_STATUS_BADGE[run.status].label}</Badge>
                </IndexTableCell>
                <IndexTableCell>
                  <Button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
                    View
                  </Button>
                </IndexTableCell>
              </IndexTableRow>
            ))}
          />
        )}
      </Section>
    </AppLayout>
  );
}
