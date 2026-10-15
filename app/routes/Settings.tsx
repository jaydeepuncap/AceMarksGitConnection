import { useCallback, useEffect, useRef, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { IgnorePatternsEditor } from '../components/IgnorePatternsEditor';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { SyncStrategy, UpdateSettingsRequest } from '../lib/types';
import { ignorePatternError } from '../../shared/theme-paths';
import {
  validateGithubToken,
  validateRepository,
  validateThemeRootInput,
} from '../lib/validation';

/** Select value for "no choice" — an empty option value is not reliable in <s-select>. */
const NONE = '__none__';

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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = async () => {
    const result = await disconnect.run();
    if (result) {
      setConfirmOpen(false);
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
              <s-button tone="critical" loading={disconnect.pending} onClick={() => setConfirmOpen(true)}>
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
      <DisconnectModal
        open={confirmOpen}
        account={info?.accountLogin ?? ''}
        pending={disconnect.pending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
    </s-section>
  );
}

function DisconnectModal({
  open,
  account,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  account: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    if (open) ref.current?.showOverlay?.();
    else ref.current?.hideOverlay?.();
  }, [open]);
  return (
    <s-modal ref={ref} id="disconnect-github-modal" heading="Disconnect GitHub?" onHide={onClose}>
      <s-paragraph>
        {`The saved token for ${account} is deleted. Syncs stop until you connect again. Theme mappings, ignore settings and the sync history are kept.`}
      </s-paragraph>
      <s-button slot="primary-action" variant="primary" tone="critical" loading={pending} onClick={onConfirm}>
        Disconnect
      </s-button>
      <s-button slot="secondary-actions" onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
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
  const [strategy, setStrategy] = useState<SyncStrategy>('since_last_sync');
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [themeRoot, setThemeRoot] = useState('');
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([]);

  const settings = settingsQuery.data?.settings;
  useEffect(() => {
    if (!settings) return;
    setRepository(settings.defaultRepository ?? '');
    setBranch(settings.defaultBranch ?? '');
    setThemeId(settings.defaultThemeId ?? '');
    setStrategy(settings.syncPreferences.strategy);
    setAllowDeletes(settings.syncPreferences.allowDeletes);
    setThemeRoot(settings.syncPreferences.themeRoot);
    setIgnorePatterns(settings.syncPreferences.ignorePatterns);
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
  const ignoreInvalid = ignorePatterns.some((p, i) => !!ignorePatternError(p) || ignorePatterns.indexOf(p) !== i);
  const invalid = !!(repoError || rootError || ignoreInvalid);
  const reposQuery = useApiQuery(() => api.github.repositories({ perPage: 100 }), [connected], connected);
  const repos = reposQuery.data?.items ?? [];

  const onSave = useCallback(async () => {
    if (invalid) return;
    const body: UpdateSettingsRequest = {
      syncPreferences: { strategy, allowDeletes, themeRoot, ignorePatterns: ignorePatterns.map((p) => p.trim()) },
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
  }, [invalid, strategy, allowDeletes, themeRoot, ignorePatterns, repository, branch, themeId, settings, save, settingsQuery]);

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

      <s-section heading="Repository and branch">
        <s-button slot="secondary-actions" variant="tertiary" disabled={!connected} onClick={go('/repositories')}>
          Browse repositories
        </s-button>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          <s-select
            label="Repository"
            value={repository || NONE}
            disabled={!connected || reposQuery.loading}
            details={
              reposQuery.error
                ? reposQuery.error.message
                : 'Repositories the connected token can read. Access is verified again when you save.'
            }
            error={repoError ?? undefined}
            onChange={(event) => {
              const value = event.currentTarget.value === NONE ? '' : event.currentTarget.value;
              setRepository(value);
              setBranch('');
            }}
          >
            <s-option value={NONE}>No repository</s-option>
            {repos.map((r) => (
              <s-option key={r.fullName} value={r.fullName}>
                {`${r.fullName}${r.private ? ' (private)' : ''}`}
              </s-option>
            ))}
            {repository && !repos.some((r) => r.fullName === repository) && (
              <s-option value={repository}>{repository}</s-option>
            )}
          </s-select>
          <s-select
            label="Default branch"
            value={branch || NONE}
            disabled={!repoValid || branchesQuery.loading}
            details={branchesQuery.error ? branchesQuery.error.message : undefined}
            onChange={(event) => setBranch(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
          >
            <s-option value={NONE}>Repository default branch</s-option>
            {branches.map((b) => (
              <s-option key={b.name} value={b.name}>
                {b.name}
              </s-option>
            ))}
            {branch && !branches.some((b) => b.name === branch) && <s-option value={branch}>{branch}</s-option>}
          </s-select>
        </s-grid>
        {settings?.defaultRepository && (
          <s-box padding="small" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={connected ? 'success' : 'caution'}>{connected ? 'Connected' : 'GitHub not connected'}</s-badge>
              <s-text>
                Owner <s-text type="strong">{settings.defaultRepository.split('/')[0]}</s-text> · repository{' '}
                <s-text type="strong">{settings.defaultRepository.split('/')[1]}</s-text> · branch{' '}
                <s-text type="strong">{settings.defaultBranch ?? 'repository default'}</s-text>
              </s-text>
            </s-stack>
          </s-box>
        )}
      </s-section>

      <s-section heading="Default Shopify theme">
        <s-stack gap="base">
          <ErrorBanner error={themesQuery.error} onRetry={themesQuery.reload} heading="Themes could not be loaded" />
          <s-select
            label="Target theme"
            value={themeId || NONE}
            onChange={(event) => setThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
          >
            <s-option value={NONE}>No default theme</s-option>
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
            label="When you click Sync, push"
            values={[strategy]}
            onChange={(event) => setStrategy((event.currentTarget.values[0] as SyncStrategy) ?? 'since_last_sync')}
          >
            <s-choice value="since_last_sync" selected={strategy === 'since_last_sync'}>
              From the last sync to the selected commit (recommended)
              <s-text slot="details">
                Pushes the selected commit together with every earlier commit on the branch that is not in the theme yet.
                The preview lists every file and the commit it comes from. A theme that was never synced gets the
                complete theme at the selected commit.
              </s-text>
            </s-choice>
            <s-choice value="commit_changes" selected={strategy === 'commit_changes'}>
              Only the selected commit
              <s-text slot="details">
                Pushes only the files changed in the selected commit. Earlier commits that are not in the theme yet are
                left out.
              </s-text>
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
            details="Delete theme files that the pushed commits removed or renamed. Protected files (layout/theme.liquid, config/*) are never deleted."
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
        </s-stack>
      </s-section>

      <s-section heading="Ignore files">
        <IgnorePatternsEditor
          patterns={ignorePatterns}
          onChange={setIgnorePatterns}
          canPreview={connected && !!settings?.defaultRepository}
        />
      </s-section>
    </AppLayout>
  );
}
