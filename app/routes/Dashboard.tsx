import { useCallback } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { MappingCard } from '../components/MappingCard';
import { Card, CardSection, StatTile } from '../components/Common';
import {
  Badge,
  Banner,
  Button,
  Grid,
  Heading,
  Icon,
  IndexTable,
  IndexTableCell,
  IndexTableRow,
  Paragraph,
  ProgressBar,
  Section,
  Stack,
  Text,
} from '../components/ui';
import { api } from '../lib/api-client';
import { firstLine, formatDate, SYNC_STATUS_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';

const RECENT = 5;

interface Step {
  title: string;
  description: string;
  done: boolean;
  action: { label: string; to: string };
}

/** One row of the setup checklist: done or still to do, with its action on the next step. */
function SetupStep({ step, next, number }: { step: Step; next: boolean; number: number }) {
  const go = useNavigateHandler();
  return (
    <Stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
      <Stack direction="inline" gap="base" alignItems="center">
        <Icon type={step.done ? 'check-circle' : 'circle-dashed'} tone={step.done ? 'success' : 'auto'} />
        <Stack gap="none">
          <Text type="strong" color={step.done ? 'subdued' : 'base'}>{`${number}. ${step.title}`}</Text>
          <Text color="subdued">{step.description}</Text>
        </Stack>
      </Stack>
      {step.done ? (
        <Badge tone="success">Done</Badge>
      ) : (
        <Button variant={next ? 'primary' : 'secondary'} disabled={!next} onClick={go(step.action.to)}>
          {step.action.label}
        </Button>
      )}
    </Stack>
  );
}

/** A connection (store, GitHub, repository): what it is, its state and one action. */
function ConnectionRow({
  icon,
  title,
  detail,
  badge,
  action,
}: {
  icon: string;
  title: string;
  detail: string;
  badge: { label: string; tone: string };
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
      <Stack direction="inline" gap="base" alignItems="center">
        <Icon type={icon} />
        <Stack gap="none">
          <Text type="strong">{title}</Text>
          <Text color="subdued">{detail}</Text>
        </Stack>
      </Stack>
      <Stack direction="inline" gap="small-200" alignItems="center">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {action && (
          <Button variant="tertiary" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * Dashboard: setup progress until everything is in place, then the store at a
 * glance — mappings with where each theme stands, connections and recent syncs.
 */
export default function Dashboard() {
  const go = useNavigateHandler();
  const load = useCallback(
    () =>
      Promise.all([
        api.settings.get(),
        api.github.connection(),
        api.sync.history({ perPage: RECENT }),
        api.mappings.list(),
        api.themes.list(),
      ]),
    [],
  );
  const { data, error, loading, reload } = useApiQuery(load, []);

  if (loading && !data) return <LoadingState title="Dashboard" />;

  const [settingsRes, github, history, mappingsRes, themesRes] = data ?? [null, null, null, null, null];
  const shop = settingsRes?.shop;
  const repository = settingsRes?.settings.defaultRepository ?? null;
  const connected = !!github?.connected;
  const themes = themesRes ?? [];
  const runs = history?.items ?? [];
  const mappings = (mappingsRes?.items ?? []).filter(
    (m) => !!repository && m.repository.toLowerCase() === repository.toLowerCase(),
  );
  const lastRun = runs[0] ?? null;
  const needsAttention = runs.filter((r) => r.status === 'failed' || r.status === 'partially_failed').length;

  const steps: Step[] = [
    {
      title: 'Connect GitHub',
      description: 'Add a personal access token that can read your theme repository.',
      done: connected,
      action: { label: 'Connect GitHub', to: '/settings' },
    },
    {
      title: 'Choose the repository',
      description: 'The repository that holds your theme code.',
      done: !!repository,
      action: { label: 'Choose repository', to: '/settings' },
    },
    {
      title: 'Map a branch to a theme',
      description: 'For example main → Live theme and staging → a copy of it.',
      done: mappings.length > 0,
      action: { label: 'Add mapping', to: '/mappings' },
    },
    {
      title: 'Run your first sync',
      description: 'Open a mapping and start with a full sync; you review every change first.',
      done: runs.length > 0,
      action: { label: 'Open mappings', to: '/mappings' },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);
  const setupComplete = nextIndex === -1;
  const paused = !connected && (mappingsRes?.items.length ?? 0) > 0;

  const primaryAction = !connected
    ? { content: 'Connect GitHub', onAction: go('/settings') }
    : !repository
      ? { content: 'Choose repository', onAction: go('/settings') }
      : { content: 'Theme mapping', onAction: go('/mappings') };

  return (
    <AppLayout
      title="Dashboard"
      subtitle="Sync your GitHub theme code to your Shopify themes, one branch per theme."
      primaryAction={primaryAction}
      secondaryActions={[{ content: 'Refresh', onAction: reload }]}
      banners={
        <>
          <ErrorBanner error={error} onRetry={reload} />
          {paused && (
            <Banner
              tone="warning"
              heading="GitHub is not connected"
              secondaryActions={[{ label: 'Connect GitHub', onClick: go('/settings') }]}
            >
              <Paragraph>
                Your mappings are paused: commits cannot be read or synced until GitHub is connected again. Nothing is
                lost — they resume when you reconnect.
              </Paragraph>
            </Banner>
          )}
        </>
      }
    >
      {!setupComplete && (
        <Card>
          <CardSection>
            <Stack gap="small-200">
              <Stack direction="inline" justifyContent="space-between" alignItems="center">
                <Heading>Get set up</Heading>
                <Text color="subdued">{`${doneCount} of ${steps.length} done`}</Text>
              </Stack>
              <ProgressBar progress={(doneCount / steps.length) * 100} tone="success" size="small" />
            </Stack>
          </CardSection>
          {steps.map((step, i) => (
            <CardSection key={step.title}>
              <SetupStep step={step} number={i + 1} next={i === nextIndex} />
            </CardSection>
          ))}
        </Card>
      )}

      <Grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        <StatTile label="Theme mappings" hint={connected ? 'branches syncing to themes' : 'paused'}>
          <Heading>{String(mappings.length)}</Heading>
        </StatTile>
        <StatTile label="Store themes" hint={`${themes.filter((t) => t.writable).length} can be synced`}>
          <Heading>{String(themes.length)}</Heading>
        </StatTile>
        <StatTile label="Last sync" hint={lastRun ? formatDate(lastRun.completedAt ?? lastRun.initiatedAt) : undefined}>
          {lastRun ? (
            <Stack direction="inline">
              <Badge tone={SYNC_STATUS_BADGE[lastRun.status].tone}>{SYNC_STATUS_BADGE[lastRun.status].label}</Badge>
            </Stack>
          ) : (
            <Text color="subdued">No sync yet</Text>
          )}
        </StatTile>
        <StatTile label="Needs attention" hint={`of the last ${RECENT} syncs`}>
          <Stack direction="inline" gap="small-200" alignItems="center">
            <Icon
              type={needsAttention ? 'alert-triangle' : 'check-circle'}
              tone={needsAttention ? 'critical' : 'success'}
            />
            <Heading>{String(needsAttention)}</Heading>
          </Stack>
        </StatTile>
      </Grid>

      <Grid gridTemplateColumns="repeat(auto-fit, minmax(340px, 1fr))" gap="base" alignItems="start">
        <Section heading="Your mappings">
          {mappings.length > 0 && (
            <Button slot="secondary-actions" variant="tertiary" onClick={go('/mappings')}>
              Manage
            </Button>
          )}
          {mappings.length === 0 ? (
            <Stack gap="base">
              <Paragraph color="subdued">
                {connected && repository
                  ? 'No branch is mapped to a theme yet. Map one to start syncing.'
                  : 'Connect GitHub and choose a repository, then map its branches to themes.'}
              </Paragraph>
              <Stack direction="inline">
                <Button disabled={!connected || !repository} onClick={go('/mappings')}>
                  Add mapping
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack gap="base">
              {mappings.slice(0, 3).map((m) => (
                <MappingCard
                  key={m.id}
                  mapping={m}
                  theme={themes.find((t) => t.id === m.themeId)}
                  themesLoaded={!!themesRes}
                />
              ))}
              {mappings.length > 3 && (
                <Button variant="tertiary" onClick={go('/mappings')}>
                  {`View all ${mappings.length} mappings`}
                </Button>
              )}
            </Stack>
          )}
        </Section>

        <Section heading="Connections">
          <Stack gap="base">
            <ConnectionRow
              icon="store"
              title={shop?.shopDomain ?? 'Shopify store'}
              detail={
                shop?.canWriteThemes ? 'Can read and write themes' : shop?.canReadThemes ? 'Can read themes only' : '—'
              }
              badge={
                shop?.status === 'installed'
                  ? { label: 'Connected', tone: 'success' }
                  : { label: 'Not installed', tone: 'critical' }
              }
            />
            <ConnectionRow
              icon="code"
              title="GitHub"
              detail={github?.connection ? `Signed in as ${github.connection.accountLogin}` : 'No token added yet'}
              badge={connected ? { label: 'Connected', tone: 'success' } : { label: 'Not connected', tone: 'caution' }}
              action={connected ? undefined : { label: 'Connect', onClick: go('/settings') }}
            />
            <ConnectionRow
              icon="git-repository"
              title={repository ?? 'Repository'}
              detail={repository ? `${mappings.length} branch(es) mapped to themes` : 'Not chosen yet'}
              badge={repository ? { label: 'Selected', tone: 'info' } : { label: 'None', tone: 'neutral' }}
              action={{ label: repository ? 'Change' : 'Choose', onClick: go('/settings') }}
            />
          </Stack>
        </Section>
      </Grid>

      <Section heading="Recent syncs">
        {runs.length > 0 && (
          <Button slot="secondary-actions" variant="tertiary" onClick={go('/sync-history')}>
            View all
          </Button>
        )}
        {runs.length === 0 ? (
          <Paragraph color="subdued">
            No syncs yet. Open a mapping and start with a full sync — you review every change before anything is
            written.
          </Paragraph>
        ) : (
          <IndexTable
            variant="auto"
            columns={[
              { title: 'Commit', listSlot: 'primary' },
              { title: 'Branch → theme', listSlot: 'secondary' },
              { title: 'Type', listSlot: 'labeled' },
              { title: 'Status', listSlot: 'inline' },
              { title: 'When', listSlot: 'labeled' },
              { title: '' },
            ]}
            rows={runs.map((run) => (
              <IndexTableRow key={run.id}>
                <IndexTableCell>
                  <Stack gap="none">
                    <Text type="strong">{run.commitSha.slice(0, 7)}</Text>
                    <Text color="subdued">{firstLine(run.commitMessage)}</Text>
                  </Stack>
                </IndexTableCell>
                <IndexTableCell>
                  <Text>{`${run.branch ?? '—'} → ${run.themeName}`}</Text>
                </IndexTableCell>
                <IndexTableCell>{syncTypeLabel(run.strategy)}</IndexTableCell>
                <IndexTableCell>
                  <Badge tone={SYNC_STATUS_BADGE[run.status].tone}>{SYNC_STATUS_BADGE[run.status].label}</Badge>
                </IndexTableCell>
                <IndexTableCell>{formatDate(run.completedAt ?? run.startedAt ?? run.initiatedAt)}</IndexTableCell>
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
