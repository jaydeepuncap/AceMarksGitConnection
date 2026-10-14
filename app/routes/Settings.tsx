import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { ConnectionCheck, ConnectionTestResponse, UpdateSettingsRequest } from '../lib/types';
import { parseIgnorePatterns, validateGithubToken, validateRepository, validateThemeRootInput } from '../lib/validation';
import { describeProtectedPattern } from '../../shared/theme-paths';

function GithubTokenForm({ onChanged }: { onChanged: () => void }) {
  const connection = useApiQuery(() => api.github.connection(), []);
  const [token, setToken] = useState('');
  const [touched, setTouched] = useState(false);
  const connect = useMutation(api.github.connect);
  const disconnect = useMutation(api.github.disconnect);
  const tokenError = touched ? validateGithubToken(token) : null;

  const submit = async () => {
    setTouched(true);
    if (validateGithubToken(token)) return;
    const result = await connect.run({ token: token.trim() });
    if (result) {
      setToken(''); // never keep the token in UI state longer than needed
      setTouched(false);
      connection.setData(result);
      showToast('GitHub connected');
      onChanged();
    }
  };
  const remove = async () => {
    const result = await disconnect.run();
    if (result) {
      connection.setData(result);
      showToast('GitHub token removed');
      onChanged();
    }
  };

  const info = connection.data?.connection;
  return (
    <s-stack gap="base">
      <ErrorBanner error={connection.error ?? connect.error ?? disconnect.error} onDismiss={connect.clearError} />
      {info ? (
        <s-stack gap="small-200">
          <s-paragraph>
            Account <s-text type="strong">{info.accountLogin}</s-text> ·{' '}
            {info.authType === 'fine_grained_pat' ? 'fine-grained token' : 'classic token'}
          </s-paragraph>
          <s-text color="subdued">
            {`Verified ${formatDate(info.lastVerifiedAt)}${info.tokenExpiresAt ? ` · token expires ${formatDate(info.tokenExpiresAt)}` : ''}`}
          </s-text>
          <s-stack direction="inline">
            <s-button tone="critical" loading={disconnect.pending} onClick={remove}>
              Remove token
            </s-button>
          </s-stack>
        </s-stack>
      ) : connection.data?.usingSharedToken ? (
        <s-paragraph color="subdued">Using the collection&apos;s shared GitHub access. You can add a store-specific token instead.</s-paragraph>
      ) : null}
      <s-paragraph color="subdued">
        Create a{' '}
        <s-link href="https://github.com/settings/personal-access-tokens/new" target="_blank">
          fine-grained personal access token
        </s-link>{' '}
        limited to the master theme repository with Contents: Read-only and Metadata: Read-only. It is encrypted on the
        server and never shown again.
      </s-paragraph>
      <s-password-field
        label={info ? 'Replace token' : 'Personal access token'}
        value={token}
        autocomplete="off"
        error={tokenError ?? undefined}
        onInput={(event) => setToken(event.currentTarget.value)}
      />
      <s-stack direction="inline">
        <s-button loading={connect.pending} onClick={submit}>
          {info ? 'Update token' : 'Connect GitHub'}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

/** Select values for "no choice" — an empty option value is not reliable in <s-select>. */
const DEFAULT_BRANCH = '__default__';
const NONE = '__none__';

function CheckRow({ label, check }: { label: string; check: ConnectionCheck }) {
  return (
    <s-grid gridTemplateColumns="8rem 1fr auto" gap="base" alignItems="center">
      <s-text type="strong">{label}</s-text>
      <s-text>{check.message}</s-text>
      <s-badge tone={check.ok ? 'success' : 'critical'}>{check.ok ? 'Connected' : 'Problem'}</s-badge>
    </s-grid>
  );
}

/** One-time setup: connections, Staging/Live themes and protected files. */
export default function Settings() {
  const settingsQuery = useApiQuery(() => api.settings.get(), []);
  const themesQuery = useApiQuery(() => api.themes.list(), []);
  const githubQuery = useApiQuery(() => api.github.connection(), []);
  const save = useMutation(api.settings.update);
  const test = useMutation(api.settings.test);
  const [testResult, setTestResult] = useState<ConnectionTestResponse | null>(null);

  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [stagingId, setStagingId] = useState('');
  const [liveId, setLiveId] = useState('');
  const [themeRoot, setThemeRoot] = useState('');
  const [protectedText, setProtectedText] = useState('');
  const [ignoreText, setIgnoreText] = useState('');

  const data = settingsQuery.data;
  const settings = data?.settings;
  useEffect(() => {
    if (!settings) return;
    setRepository(settings.repository ?? '');
    setBranch(settings.branch ?? '');
    setStagingId(settings.stagingTheme?.id ?? '');
    setLiveId(settings.liveTheme?.id ?? '');
    setThemeRoot(settings.preferences.themeRoot);
    setProtectedText(settings.preferences.protectedPatterns.join('\n'));
    setIgnoreText(settings.preferences.ignorePatterns.join('\n'));
  }, [settings]);

  const connected = !!githubQuery.data?.connected;
  const repoValue = repository.trim();
  const repoValid = repoValue !== '' && !validateRepository(repoValue);
  const branchesQuery = useApiQuery(
    () => api.github.branches({ repository: repoValue, perPage: 100 }),
    [repoValid ? repoValue : ''],
    repoValid && connected,
  );

  const repoError = repoValue ? validateRepository(repoValue) : null;
  const rootError = validateThemeRootInput(themeRoot);
  const protectedPatterns = parseIgnorePatterns(protectedText);
  const ignore = parseIgnorePatterns(ignoreText);
  const sameTheme = !!stagingId && stagingId === liveId;
  const invalid = !!(repoError || rootError || protectedPatterns.error || ignore.error || sameTheme);

  const onSave = useCallback(async () => {
    if (invalid || !settings) return;
    const body: UpdateSettingsRequest = {
      preferences: { themeRoot, protectedPatterns: protectedPatterns.patterns, ignorePatterns: ignore.patterns },
    };
    if (repoValue !== (settings.repository ?? '') || branch !== (settings.branch ?? '')) {
      body.repository = repoValue || null;
      body.branch = repoValue ? branch || null : null;
    }
    if (stagingId !== (settings.stagingTheme?.id ?? '')) body.stagingThemeId = stagingId || null;
    if (liveId !== (settings.liveTheme?.id ?? '')) body.liveThemeId = liveId || null;
    const result = await save.run(body);
    if (result) {
      settingsQuery.setData(result);
      showToast('Settings saved');
    }
  }, [invalid, settings, themeRoot, protectedPatterns.patterns, ignore.patterns, repoValue, branch, stagingId, liveId, save, settingsQuery]);

  const onTest = async () => {
    const result = await test.run();
    if (result) setTestResult(result);
  };

  if (settingsQuery.loading && !data) return <LoadingState title="Settings" />;
  const themes = themesQuery.data ?? [];
  const staging = themes.find((t) => t.id === stagingId);
  const live = themes.find((t) => t.id === liveId);
  const branches = branchesQuery.data?.items ?? [];

  return (
    <AppLayout
      title="Settings"
      subtitle={`Connections and theme rules · ${data?.shop.name ?? data?.shop.shopDomain ?? ''}`}
      primaryAction={{ content: 'Save settings', onAction: onSave, loading: save.pending, disabled: invalid }}
      secondaryActions={[{ content: 'Test connection', onAction: onTest, loading: test.pending }]}
      banners={
        <>
          <ErrorBanner error={settingsQuery.error} onRetry={settingsQuery.reload} />
          <ErrorBanner error={save.error} heading="Settings were not saved" onDismiss={save.clearError} />
          <ErrorBanner error={test.error} heading="The connection test could not run" onDismiss={test.clearError} />
        </>
      }
    >
      {testResult && (
        <s-section heading="Connection test">
          <s-stack gap="base">
            <CheckRow label="GitHub" check={testResult.github} />
            <s-divider />
            <CheckRow label="Shopify" check={testResult.shopify} />
            <s-divider />
            <s-grid gridTemplateColumns="8rem 1fr auto" gap="base" alignItems="center">
              <s-text type="strong">Theme updates</s-text>
              <s-text>{testResult.themeWrites.message}</s-text>
              <s-badge tone={testResult.themeWrites.allowed ? 'success' : testResult.themeWrites.allowed === false ? 'critical' : 'neutral'}>
                {testResult.themeWrites.allowed ? 'Allowed' : testResult.themeWrites.allowed === false ? 'Not allowed' : 'Not checked'}
              </s-badge>
            </s-grid>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Connections">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="8rem 1fr auto" gap="base" alignItems="center">
            <s-text type="strong">GitHub</s-text>
            <s-text>{settings?.repository ?? data?.masterRepository ?? 'No repository chosen'}</s-text>
            <s-badge tone={connected ? 'success' : 'caution'}>{connected ? 'Connected' : 'Not connected'}</s-badge>
          </s-grid>
          <s-divider />
          <s-grid gridTemplateColumns="8rem 1fr auto" gap="base" alignItems="center">
            <s-text type="strong">Shopify</s-text>
            <s-text>{data?.shop.shopDomain ?? ''}</s-text>
            <s-badge tone={data?.shop.canWriteThemes ? 'success' : 'warning'}>
              {data?.shop.canWriteThemes ? 'Connected' : 'Missing write_themes'}
            </s-badge>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Master repository">
        <s-stack gap="base">
          <GithubTokenForm
            onChanged={() => {
              githubQuery.reload();
              settingsQuery.reload();
            }}
          />
          <s-divider />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            <s-text-field
              label="Repository"
              placeholder={data?.masterRepository ?? 'owner/name'}
              value={repository}
              autocomplete="off"
              details={data?.masterRepository && !repository ? `Uses the collection's master repository ${data.masterRepository}` : undefined}
              error={repoError ?? undefined}
              disabled={!connected}
              onInput={(event) => setRepository(event.currentTarget.value)}
            />
            <s-select
              label="Branch"
              value={branch || DEFAULT_BRANCH}
              disabled={!repoValid || branchesQuery.loading}
              details={branchesQuery.error ? branchesQuery.error.message : 'Updates are listed from this branch.'}
              onChange={(event) => setBranch(event.currentTarget.value === DEFAULT_BRANCH ? '' : event.currentTarget.value)}
            >
              <s-option value={DEFAULT_BRANCH}>Repository default</s-option>
              {branches.map((b) => (
                <s-option key={b.name} value={b.name}>
                  {b.name}
                </s-option>
              ))}
              {branch && !branches.some((b) => b.name === branch) && <s-option value={branch}>{branch}</s-option>}
            </s-select>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Staging and Live themes">
        <s-stack gap="base">
          <ErrorBanner error={themesQuery.error} onRetry={themesQuery.reload} heading="Themes could not be loaded" />
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Line of work</s-table-header>
              <s-table-header>Theme</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="secondary">Receives</s-table-header>
            </s-table-header-row>
            <s-table-body>
              <s-table-row>
                <s-table-cell>Work in progress</s-table-cell>
                <s-table-cell>
                  <s-select label="Staging theme" labelAccessibilityVisibility="exclusive" value={stagingId || NONE} onChange={(e) => setStagingId(e.currentTarget.value === NONE ? '' : e.currentTarget.value)}>
                    <s-option value={NONE}>Choose the Staging theme</s-option>
                    {themes
                      .filter((t) => !t.isLive)
                      .map((t) => (
                        <s-option key={t.id} value={t.id} disabled={!t.writable}>
                          {t.writable ? t.name : `${t.name} — read-only`}
                        </s-option>
                      ))}
                  </s-select>
                </s-table-cell>
                <s-table-cell>{staging ? <s-badge tone="neutral">Unpublished</s-badge> : <s-text color="subdued">—</s-text>}</s-table-cell>
                <s-table-cell>Every new update first</s-table-cell>
              </s-table-row>
              <s-table-row>
                <s-table-cell>Staging-verified</s-table-cell>
                <s-table-cell>
                  <s-select label="Live theme" labelAccessibilityVisibility="exclusive" value={liveId || NONE} onChange={(e) => setLiveId(e.currentTarget.value === NONE ? '' : e.currentTarget.value)}>
                    <s-option value={NONE}>Choose the Live theme</s-option>
                    {themes.map((t) => (
                      <s-option key={t.id} value={t.id} disabled={!t.writable}>
                        {`${t.name}${t.isLive ? ' (published)' : ''}`}
                      </s-option>
                    ))}
                  </s-select>
                </s-table-cell>
                <s-table-cell>
                  {live ? (
                    live.isLive ? (
                      <s-badge tone="success">Published</s-badge>
                    ) : (
                      <s-badge tone="neutral">Unpublished</s-badge>
                    )
                  ) : (
                    <s-text color="subdued">—</s-text>
                  )}
                </s-table-cell>
                <s-table-cell>Staging-verified updates only</s-table-cell>
              </s-table-row>
            </s-table-body>
          </s-table>
          {sameTheme && (
            <s-banner tone="critical">
              <s-paragraph>Staging and Live must be different themes.</s-paragraph>
            </s-banner>
          )}
          {live && !live.isLive && (
            <s-banner tone="info">
              <s-paragraph>The Live theme you chose is not the published theme. Theme Sync never changes which theme is published.</s-paragraph>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Protected · never replaced">
        <s-stack gap="base">
          <s-stack gap="small-200">
            {protectedPatterns.patterns.map((pattern) => (
              <s-grid key={pattern} gridTemplateColumns="1fr auto" gap="base">
                <s-text>{`◆ ${pattern}`}</s-text>
                <s-text color="subdued">{describeProtectedPattern(pattern)}</s-text>
              </s-grid>
            ))}
          </s-stack>
          <s-text-area
            label="Protected files"
            details="One pattern per line. Protected files that already exist in a theme are never replaced or removed; new ones are created. * matches within a folder, ** across folders."
            value={protectedText}
            rows={4}
            error={protectedPatterns.error ?? undefined}
            onInput={(event) => setProtectedText(event.currentTarget.value)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Advanced">
        <s-stack gap="base">
          <s-text-field
            label="Theme folder in the repository"
            placeholder="Leave empty if the theme is at the repository root"
            value={themeRoot}
            autocomplete="off"
            error={rootError ?? undefined}
            onInput={(event) => setThemeRoot(event.currentTarget.value)}
          />
          <s-text-area
            label="Ignored files"
            details="Theme paths Theme Sync never creates, changes or removes. One pattern per line."
            value={ignoreText}
            rows={3}
            error={ignore.error ?? undefined}
            onInput={(event) => setIgnoreText(event.currentTarget.value)}
          />
        </s-stack>
      </s-section>
    </AppLayout>
  );
}
