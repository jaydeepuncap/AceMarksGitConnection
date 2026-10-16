import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api-client';
import { firstLine, formatDate, mappingStatus, RESULT_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery } from '../lib/hooks';
import type { ShopifyTheme, ThemeMapping as Mapping } from '../lib/types';
import { BranchThemeTitle, Card, CardSection, KeyValue, StatusBadge } from './Common';
import { Badge, Grid, Icon, Stack, Text } from './ui';

/** One branch → theme mapping with where it stands; the whole card opens its page. */
export function MappingCard({
  mapping,
  theme,
  themesLoaded,
}: {
  mapping: Mapping;
  theme: ShopifyTheme | undefined;
  themesLoaded: boolean;
}) {
  const navigate = useNavigate();
  // One commit is enough: the response says what the theme is on and how many commits wait.
  const commits = useApiQuery(
    () =>
      api.commits.list({
        repository: mapping.repository,
        branch: mapping.branch,
        page: 1,
        perPage: 1,
        themeId: mapping.themeId,
      }),
    [mapping.id],
  );
  const last = useApiQuery(() => api.sync.last({ themeId: mapping.themeId, branch: mapping.branch }), [mapping.id]);
  const lastSynced = commits.data?.lastSynced ?? null;
  const run = last.data ?? null;
  const result = run ? RESULT_BADGE[run.status] : undefined;
  const checking = commits.loading || last.loading;
  const status = checking
    ? { key: 'checking' as const, label: 'Checking…', tone: 'neutral' as const }
    : mappingStatus({
        themeName: mapping.themeName,
        branch: mapping.branch,
        lastSyncedSha: lastSynced?.sha ?? null,
        waiting: commits.data ? commits.data.waiting : null,
        waitingMore: !!commits.data?.waitingMore,
        lastRunStatus: run?.status ?? null,
      });
  const next =
    status.label === 'Not synced yet' ? 'Start full sync' : status.tone === 'info' ? 'Sync updates' : 'Open mapping';

  return (
    <Card
      onClick={() => navigate(`/mappings/${mapping.id}`)}
      accessibilityLabel={`Open ${mapping.branch} → ${mapping.themeName}`}
    >
      <CardSection>
        <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <BranchThemeTitle
            heading
            branch={mapping.branch}
            themeName={mapping.themeName}
            role={theme?.role}
            themeMissing={themesLoaded && !theme}
          />
          <StatusBadge status={status.key} label={status.label} />
        </Stack>
      </CardSection>
      <CardSection subdued>
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="large">
          <KeyValue label="Theme is on">
            <Text>
              {lastSynced
                ? `${lastSynced.shortSha} · ${firstLine(lastSynced.message)}`
                : checking
                  ? '…'
                  : 'No commit synced yet'}
            </Text>
          </KeyValue>
          <KeyValue label="Last sync">
            {run && result ? (
              <Stack direction="inline" gap="small-200" alignItems="center">
                <Badge tone={result.tone}>{result.label}</Badge>
                <Text>{`${syncTypeLabel(run.strategy)} · ${formatDate(run.completedAt)}`}</Text>
              </Stack>
            ) : lastSynced ? (
              // The commit was recorded from the theme's sync file (e.g. a copied theme), not by a sync here.
              <Text>{`Not synced from this app yet · recorded from the theme file ${formatDate(lastSynced.syncedAt)}`}</Text>
            ) : (
              <Text>{checking ? '…' : 'No sync performed yet'}</Text>
            )}
          </KeyValue>
        </Grid>
      </CardSection>
      <CardSection>
        <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <Text color="subdued">{`Theme ID ${mapping.themeId.split('/').pop()} · mapped ${formatDate(mapping.createdAt)}`}</Text>
          <Stack direction="inline" gap="small-100" alignItems="center">
            <Text type="strong">{next}</Text>
            <Icon type="chevron-right" />
          </Stack>
        </Stack>
      </CardSection>
    </Card>
  );
}
