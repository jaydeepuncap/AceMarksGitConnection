import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { firstLine, formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import type { ThemeMapping } from '../lib/types';
import {
  Badge,
  Banner,
  Box,
  Button,
  Icon,
  IndexTable,
  IndexTableCell,
  IndexTableRow,
  Paragraph,
  Section,
  Stack,
  Text,
} from '../components/ui';

/** Every theme in the store, the branch it receives and the commit it is on. */
export default function Themes() {
  const go = useNavigateHandler();
  const themes = useApiQuery(() => api.themes.list(), []);
  const onCommit = useApiQuery(() => api.themes.lastSynced(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const settings = useApiQuery(() => api.settings.get(), []);

  if (themes.loading && !themes.data) return <LoadingState title="Themes" />;

  const items = themes.data ?? [];
  const repository = settings.data?.settings.defaultRepository?.toLowerCase() ?? '';
  const sameRepo = (m: ThemeMapping) => m.repository.toLowerCase() === repository;

  return (
    <AppLayout
      title="Themes"
      subtitle="Every theme in the store and the branch it receives"
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: () => (themes.reload(), onCommit.reload(), mappings.reload()),
        },
      ]}
      banners={
        <>
          <ErrorBanner error={themes.error} onRetry={themes.reload} />
          {settings.data && !settings.data.shop.canWriteThemes && (
            <Banner tone="warning" heading="Theme write access not granted">
              <Paragraph>
                The app can list themes but cannot change their files until the write_themes scope is granted.
              </Paragraph>
            </Banner>
          )}
        </>
      }
    >
      <Section padding="none" accessibilityLabel="Themes">
        {items.length === 0 ? (
          <Box padding="base">
            <Paragraph color="subdued">This store has no online store themes.</Paragraph>
          </Box>
        ) : (
          <IndexTable
            variant="auto"
            columns={[
              { title: 'Theme', listSlot: 'primary' },
              { title: 'Role', listSlot: 'inline' },
              { title: 'Receives', listSlot: 'secondary' },
              { title: 'Theme is on', listSlot: 'labeled' },
              { title: 'Action' },
            ]}
            rows={items.map((t) => {
              const m = mappings.data?.items.find((x) => x.themeId === t.id);
              const role = THEME_ROLE_BADGE[t.role];
              const on = onCommit.data?.[t.id];
              return (
                <IndexTableRow key={t.id}>
                  <IndexTableCell>
                    <Stack gap="none">
                      <Stack direction="inline" gap="small-200" alignItems="center">
                        <Text type="strong">{t.name}</Text>
                        {t.processing && <Badge tone="caution">Processing</Badge>}
                        {t.processingFailed && <Badge tone="critical">Processing failed</Badge>}
                      </Stack>
                      <Text color="subdued">{`ID ${t.numericId}`}</Text>
                    </Stack>
                  </IndexTableCell>
                  <IndexTableCell>
                    <Badge tone={role.tone}>{role.label}</Badge>
                  </IndexTableCell>
                  <IndexTableCell>
                    {m ? (
                      <Stack direction="inline" gap="small-100" alignItems="center">
                        <Icon type="git-branch" />
                        <Text>{sameRepo(m) ? m.branch : `${m.repository} · ${m.branch}`}</Text>
                      </Stack>
                    ) : (
                      <Text color="subdued">{t.writable ? 'Not mapped' : 'Cannot be synced'}</Text>
                    )}
                  </IndexTableCell>
                  <IndexTableCell>
                    {on ? (
                      <Stack gap="none">
                        <Text>{`${on.shortSha} · ${firstLine(on.message)}`}</Text>
                        <Text color="subdued">{`${on.branch} · ${formatDate(on.syncedAt)}`}</Text>
                      </Stack>
                    ) : (
                      <Text color="subdued">No sync yet</Text>
                    )}
                  </IndexTableCell>
                  <IndexTableCell>
                    {m && sameRepo(m) ? (
                      <Button variant="tertiary" onClick={go(`/mappings/${m.id}`)}>
                        Open mapping
                      </Button>
                    ) : !m && t.writable ? (
                      <Button variant="tertiary" onClick={go(`/mappings?themeId=${encodeURIComponent(t.id)}`)}>
                        Map a branch
                      </Button>
                    ) : (
                      <Text color="subdued">—</Text>
                    )}
                  </IndexTableCell>
                </IndexTableRow>
              );
            })}
          />
        )}
      </Section>
    </AppLayout>
  );
}
