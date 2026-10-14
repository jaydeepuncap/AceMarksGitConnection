import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { SyncStrategy, UpdateSettingsRequest } from '../lib/types';
import {
  parseIgnorePatterns,
  validateGithubToken,
  validateRepository,
  validateThemeRootInput,
} from '../lib/validation';

function GithubConnectionSection({ onChanged }: { onChanged: () => void }) {
  const connection = useApiQuery(() => api.github.connection(), []);
  const [token, setToken] = useState('');
  const [repository, setRepository] = useState('');
  const [touched, setTouched] = useState(false);
  const connect = useMutation(api.github.connect);
  const disconnect = useMutation(api.github.disconnect);

  const tokenError = touched ? validateGithubToken(token) : null;
  const repoError = touched && repository.trim() ? validateRepository(repository) : null;

  const submit = async () => {
    setTouched(true);
    if (validateGithubToken(token) || (repository.trim() && validateRepository(repository))) return;
    const result = await connect.run({ token: token.trim(), repository: repository.trim() || undefined });
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
      showToast('GitHub disconnected');
      onChanged();
    }
  };

  const info = connection.data?.connection;
  return (
    <s-section heading="GitHub connection">
      {connection.data && (
        <s-badge slot="secondary-actions" tone={connection.data.connected ? 'success' : 'caution'}>
          {connection.data.connected ? 'Connected' : 'Not connected'}
        </s-badge>
      )}
      <s-stack gap="base">
        <ErrorBanner error={connection.error ?? connect.error ?? disconnect.error} onDismiss={connect.clearError} />

        {info && (
          <s-stack gap="small-200">
            <s-paragraph>
              Account <s-text type="strong">{info.accountLogin}</s-text> ·{' '}
              {info.authType === 'fine_grained_pat' ? 'fine-grained token' : 'classic token'}
            </s-paragraph>
            <s-text color="subdued">
              Verified {formatDate(info.lastVerifiedAt)}
              {info.tokenExpiresAt ? ` · token expires ${formatDate(info.tokenExpiresAt)}` : ''}
            </s-text>
            <s-stack direction="inline">
              <s-button tone="critical" loading={disconnect.pending} onClick={remove}>
                Disconnect
              </s-button>
            </s-stack>
          </s-stack>
        )}

        <s-paragraph color="subdued">
          Create a{' '}
          <s-link href="https://github.com/settings/personal-access-tokens/new" target="_blank">
            fine-grained personal access token
          </s-link>{' '}
          limited to your theme repository with Contents: Read-only and Metadata: Read-only. The token is encrypted
          on the server and is never shown again.
        </s-paragraph>
        <s-password-field
          label={info ? 'Replace token' : 'Personal access token'}
          value={token}
          autocomplete="off"
          error={tokenError ?? undefined}
          onInput={(event) => setToken(event.currentTarget.value)}
        />
        <s-text-field
          label="Repository (optional)"
          placeholder="owner/name"
          value={repository}
          autocomplete="off"
          details="Verifies the token can read this repository right away."
          error={repoError ?? undefined}
          onInput={(event) => setRepository(event.currentTarget.value)}
        />
        <s-stack direction="inline">
          <s-button variant="primary" loading={connect.pending} onClick={submit}>
            {info ? 'Update connection' : 'Connect GitHub'}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function Settings() {
  const go = useNavigateHandler();
  const settingsQuery = useApiQuery(() => api.settings.get(), []);
  const themesQuery = useApiQuery(() => api.themes.list(), []);
  const githubQuery = useApiQuery(() => api.github.connection(), []);
  const save = useMutation(api.settings.update);

  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [themeId, setThemeId] = useState('');
  const [strategy, setStrategy] = useState<SyncStrategy>('commit_changes');
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [themeRoot, setThemeRoot] = useState('');
  const [ignoreText, setIgnoreText] = useState('');

  const settings = settingsQuery.data?.settings;
  useEffect(() => {
    if (!settings) return;
    setRepository(settings.defaultRepository ?? '');
    setBranch(settings.defaultBranch ?? '');
    setThemeId(settings.defaultThemeId ?? '');
    setStrategy(settings.syncPreferences.strategy);
    setAllowDeletes(settings.syncPreferences.allowDeletes);
    setThemeRoot(settings.syncPreferences.themeRoot);
    setIgnoreText(settings.syncPreferences.ignorePatterns.join('\n'));
  }, [settings]);

  const connected = !!githubQuery.data?.connected;
  const repoValid = repository.trim() !== '' && !validateRepository(repository);
  const branchesQuery = useApiQuery(
    () => api.github.branches({ repository: repository.trim(), perPage: 100 }),
    [repoValid ? repository.trim() : ''],
    repoValid && connected,
  );

  const repoError = repository.trim() ? validateRepository(repository) : null;
  const rootError = validateThemeRootInput(themeRoot);
  const ignore = parseIgnorePatterns(ignoreText);
  const invalid = !!(repoError || rootError || ignore.error);

  const onSave = useCallback(async () => {
    if (invalid) return;
    const body: UpdateSettingsRequest = {
      syncPreferences: { strategy, allowDeletes, themeRoot, ignorePatterns: ignore.patterns },
    };
    if (repository.trim() !== (settings?.defaultRepository ?? '') || branch !== (settings?.defaultBranch ?? '')) {
      body.defaultRepository = repository.trim() || null;
      body.defaultBranch = repository.trim() ? branch || null : null;
    }
    if (themeId !== (settings?.defaultThemeId ?? '')) body.defaultThemeId = themeId || null;
    const result = await save.run(body);
    if (result) {
      settingsQuery.setData(result);
      showToast('Settings saved');
    }
  }, [invalid, strategy, allowDeletes, themeRoot, ignore.patterns, repository, branch, themeId, settings, save, settingsQuery]);

  if (settingsQuery.loading && !settingsQuery.data) return <LoadingState title="Settings" />;

  const branches = branchesQuery.data?.items ?? [];
  const selectedTheme = themesQuery.data?.find((t) => t.id === themeId);

  return (
    <AppLayout
      title="Settings"
      primaryAction={{ content: 'Save', onAction: onSave, loading: save.pending, disabled: invalid }}
      banners={
        <>
          <ErrorBanner error={settingsQuery.error} onRetry={settingsQuery.reload} />
          <ErrorBanner error={save.error} heading="Settings were not saved" onDismiss={save.clearError} />
        </>
      }
    >
      <GithubConnectionSection
        onChanged={() => {
          githubQuery.reload();
          settingsQuery.reload();
        }}
      />

      <s-section heading="Repository">
        <s-button slot="secondary-actions" variant="tertiary" disabled={!connected} onClick={go('/repositories')}>
          Browse repositories
        </s-button>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          <s-text-field
            label="Default repository"
            placeholder="owner/name"
            value={repository}
            autocomplete="off"
            error={repoError ?? undefined}
            disabled={!connected}
            onInput={(event) => setRepository(event.currentTarget.value)}
          />
          <s-select
            label="Default branch"
            value={branch}
            disabled={!repoValid || branchesQuery.loading}
            details={branchesQuery.error ? branchesQuery.error.message : undefined}
            onChange={(event) => setBranch(event.currentTarget.value)}
          >
            <s-option value="">Repository default</s-option>
            {branches.map((b) => (
              <s-option key={b.name} value={b.name}>
                {b.name}
              </s-option>
            ))}
            {branch && !branches.some((b) => b.name === branch) && <s-option value={branch}>{branch}</s-option>}
          </s-select>
        </s-grid>
      </s-section>

      <s-section heading="Default Shopify theme">
        <s-stack gap="base">
          <ErrorBanner error={themesQuery.error} onRetry={themesQuery.reload} heading="Themes could not be loaded" />
          <s-select label="Target theme" value={themeId} onChange={(event) => setThemeId(event.currentTarget.value)}>
            <s-option value="">No default theme</s-option>
            {(themesQuery.data ?? []).map((t) => (
              <s-option key={t.id} value={t.id} disabled={!t.writable}>
                {`${t.name}${t.isLive ? ' (live)' : ''}${t.writable ? '' : ' — read-only'}`}
              </s-option>
            ))}
          </s-select>
          {selectedTheme?.isLive && (
            <s-banner tone="warning">
              <s-paragraph>This is the live theme. Every sync to it will require an extra confirmation.</s-paragraph>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Sync preferences">
        <s-stack gap="base">
          <s-choice-list
            label="Strategy"
            values={[strategy]}
            onChange={(event) => setStrategy((event.currentTarget.values[0] as SyncStrategy) ?? 'commit_changes')}
          >
            <s-choice value="commit_changes" selected={strategy === 'commit_changes'}>
              Commit changes
              <s-text slot="details">Apply only the files changed in the selected commit.</s-text>
            </s-choice>
            <s-choice value="full_snapshot" selected={strategy === 'full_snapshot'}>
              Full snapshot
              <s-text slot="details">
                Write every theme file as it exists at the selected commit. Never deletes files.
              </s-text>
            </s-choice>
          </s-choice-list>
          <s-checkbox
            label="Allow deletions"
            details="Delete theme files that the commit removed or renamed. Protected files (layout/theme.liquid, config/*) are never deleted."
            checked={allowDeletes}
            onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
          />
          <s-text-field
            label="Theme root folder"
            placeholder="e.g. theme (leave empty if the theme is at the repository root)"
            value={themeRoot}
            autocomplete="off"
            error={rootError ?? undefined}
            onInput={(event) => setThemeRoot(event.currentTarget.value)}
          />
          <s-text-area
            label="Ignore patterns"
            details="One glob per line (theme paths). * matches within a folder, ** across folders."
            value={ignoreText}
            rows={4}
            error={ignore.error ?? undefined}
            onInput={(event) => setIgnoreText(event.currentTarget.value)}
          />
        </s-stack>
      </s-section>
    </AppLayout>
  );
}
