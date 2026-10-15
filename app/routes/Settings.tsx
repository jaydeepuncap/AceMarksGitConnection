import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { IgnorePatternsEditor } from '../components/IgnorePatternsEditor';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { UpdateSettingsRequest } from '../lib/types';
import { ignorePatternError } from '../../shared/theme-paths';
import { validateGithubToken, validateRepository } from '../lib/validation';
import {
  Badge,
  Banner,
  Box,
  Button,
  Icon,
  Link,
  Modal,
  Option,
  Paragraph,
  PasswordField,
  Section,
  Select,
  Stack,
  Text,
  TextField,
} from '../components/ui';

/** Select value for "no choice" — an empty option value is not reliable in <Select>. */
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
    <Section heading="GitHub connection">
      {connection.data && (
        <Badge slot="secondary-actions" tone={connection.data.connected ? 'success' : 'caution'}>
          {connection.data.connected ? 'Connected' : 'Not connected'}
        </Badge>
      )}
      <Stack gap="base">
        <ErrorBanner error={connection.error ?? connect.error ?? disconnect.error} onDismiss={connect.clearError} />

        {info && (
          <Stack gap="small-200">
            <Paragraph>
              Account <Text type="strong">{info.accountLogin}</Text> ·{' '}
              {info.authType === 'fine_grained_pat' ? 'fine-grained token' : 'classic token'}
            </Paragraph>
            <Text color="subdued">
              Verified {formatDate(info.lastVerifiedAt)}
              {info.tokenExpiresAt ? ` · token expires ${formatDate(info.tokenExpiresAt)}` : ''}
            </Text>
            <Stack direction="inline">
              <Button tone="critical" loading={disconnect.pending} onClick={() => setConfirmOpen(true)}>
                Disconnect
              </Button>
            </Stack>
          </Stack>
        )}

        <Paragraph color="subdued">
          Create a{' '}
          <Link href="https://github.com/settings/personal-access-tokens/new" target="_blank">
            fine-grained personal access token
          </Link>{' '}
          limited to your theme repository with Contents: Read-only and Metadata: Read-only. The token is encrypted on
          the server and is never shown again.
        </Paragraph>
        <PasswordField
          label={info ? 'Replace token' : 'Personal access token'}
          value={token}
          autocomplete="off"
          error={tokenError ?? undefined}
          onInput={(event) => setToken(event.currentTarget.value)}
        />
        <TextField
          label="Repository (optional)"
          placeholder="owner/name"
          value={repository}
          autocomplete="off"
          details="Verifies the token can read this repository right away."
          error={repoError ?? undefined}
          onInput={(event) => setRepository(event.currentTarget.value)}
        />
        <Stack direction="inline">
          <Button variant="primary" loading={connect.pending} onClick={submit}>
            {info ? 'Update connection' : 'Connect GitHub'}
          </Button>
        </Stack>
      </Stack>
      <DisconnectModal
        open={confirmOpen}
        account={info?.accountLogin ?? ''}
        pending={disconnect.pending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
    </Section>
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
  return (
    <Modal id="disconnect-github-modal" open={open} heading="Disconnect GitHub?" onHide={onClose}>
      <Paragraph>
        {`The saved token for ${account} is deleted. Syncs stop until you connect again. Theme mappings, ignore settings and the sync history are kept.`}
      </Paragraph>
      <Button slot="primary-action" variant="primary" tone="critical" loading={pending} onClick={onConfirm}>
        Disconnect
      </Button>
      <Button slot="secondary-actions" onClick={onClose}>
        Cancel
      </Button>
    </Modal>
  );
}

export default function Settings() {
  const settingsQuery = useApiQuery(() => api.settings.get(), []);
  const githubQuery = useApiQuery(() => api.github.connection(), []);
  const save = useMutation(api.settings.update);

  const [repository, setRepository] = useState('');
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([]);

  const settings = settingsQuery.data?.settings;
  useEffect(() => {
    if (!settings) return;
    setRepository(settings.defaultRepository ?? '');
    setIgnorePatterns(settings.syncPreferences.ignorePatterns);
  }, [settings]);

  const connected = !!githubQuery.data?.connected;
  const savedRepository = settings?.defaultRepository ?? '';
  // Details of the saved repository, shown under the choice.
  const repoInfo = useApiQuery(
    () => api.github.repository(savedRepository),
    [savedRepository, connected],
    !!savedRepository && connected,
  );

  const repoError = repository.trim() ? validateRepository(repository) : null;
  const ignoreInvalid = ignorePatterns.some((p, i) => !!ignorePatternError(p) || ignorePatterns.indexOf(p) !== i);
  const invalid = !!(repoError || ignoreInvalid);
  const reposQuery = useApiQuery(() => api.github.repositories({ perPage: 100 }), [connected], connected);
  const repos = reposQuery.data?.items ?? [];

  const onSave = useCallback(async () => {
    if (invalid) return;
    const body: UpdateSettingsRequest = {
      syncPreferences: { ignorePatterns: ignorePatterns.map((p) => p.trim()) },
    };
    // Each mapping chooses its own branch, so only the repository is saved here.
    if (repository.trim() !== savedRepository) {
      body.defaultRepository = repository.trim() || null;
      body.defaultBranch = null;
    }
    const result = await save.run(body);
    if (result) {
      settingsQuery.setData(result);
      showToast('Settings saved');
    }
  }, [invalid, ignorePatterns, repository, savedRepository, save, settingsQuery]);

  if (settingsQuery.loading && !settingsQuery.data) return <LoadingState title="Settings" />;

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

      <Section heading="Repository">
        <Stack gap="base">
          <Paragraph color="subdued">
            The app syncs from one repository. Each branch is connected to its own theme on the Theme mapping page.
          </Paragraph>
          <Select
            label="Repository"
            value={repository || NONE}
            disabled={!connected || reposQuery.loading}
            details={
              reposQuery.error
                ? reposQuery.error.message
                : !connected
                  ? 'Connect GitHub first.'
                  : 'Repositories the connected token can read. Access is verified again when you save.'
            }
            error={repoError ?? undefined}
            onChange={(event) => setRepository(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
          >
            <Option value={NONE}>No repository</Option>
            {repos.map((r) => (
              <Option key={r.fullName} value={r.fullName}>
                {`${r.fullName}${r.private ? ' (private)' : ''}`}
              </Option>
            ))}
            {repository && !repos.some((r) => r.fullName === repository) && (
              <Option value={repository}>{repository}</Option>
            )}
          </Select>
          {repository.trim() !== savedRepository && savedRepository && (
            <Banner tone="warning" heading="Changing the repository">
              <Paragraph>
                {`Mappings of ${savedRepository} stay as they are but cannot sync until you switch back. Their themes stay mapped, so remove those mappings first if you want to map the themes to the new repository.`}
              </Paragraph>
            </Banner>
          )}
          {repoInfo.data && repository.trim() === savedRepository && (
            <Box padding="small" background="subdued" borderRadius="base">
              <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                <Stack direction="inline" gap="small-200" alignItems="center">
                  <Icon type="git-repository" />
                  <Text type="strong">{repoInfo.data.fullName}</Text>
                  <Badge tone="neutral">{repoInfo.data.private ? 'Private' : 'Public'}</Badge>
                  <Badge tone={repoInfo.data.permissions.push ? 'info' : 'neutral'}>
                    {repoInfo.data.permissions.push ? 'Read & write' : 'Read only'}
                  </Badge>
                  <Text color="subdued">{`Default branch ${repoInfo.data.defaultBranch}`}</Text>
                </Stack>
                <Link href={repoInfo.data.htmlUrl} target="_blank">
                  View on GitHub
                </Link>
              </Stack>
            </Box>
          )}
        </Stack>
      </Section>

      <Section heading="Ignore files">
        <IgnorePatternsEditor
          patterns={ignorePatterns}
          onChange={setIgnorePatterns}
          canPreview={connected && !!settings?.defaultRepository}
        />
      </Section>
    </AppLayout>
  );
}
