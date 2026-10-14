import { useEffect, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { redirectTopLevel, showToast } from '../lib/app-bridge';
import { api } from '../lib/api-client';
import { firstLine, plural, type Tone } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { RolloutLiveState, RolloutPreviewResult, RolloutStagingState, RolloutStore } from '../lib/types';

const STAGING_BADGE: Record<RolloutStagingState, { label: string; tone: Tone }> = {
  up_to_date: { label: 'Up to date', tone: 'success' },
  behind: { label: 'Behind', tone: 'neutral' },
  ahead: { label: 'Ahead', tone: 'info' },
  queued: { label: 'Queued', tone: 'neutral' },
  updating: { label: 'Updating', tone: 'info' },
  failed: { label: 'Incomplete', tone: 'critical' },
  not_configured: { label: 'No unpublished theme', tone: 'warning' },
  not_installed: { label: 'Not installed', tone: 'warning' },
};

const LIVE_BADGE: Record<RolloutLiveState, { label: string; tone: Tone } | null> = {
  published: { label: 'Published', tone: 'success' },
  ready_to_publish: { label: 'Ready to publish', tone: 'caution' },
  behind: { label: 'Behind', tone: 'neutral' },
  updating: { label: 'Updating', tone: 'info' },
  not_configured: { label: 'No Live theme', tone: 'warning' },
  none: null,
};

function stagingLabel(store: RolloutStore) {
  const badge = STAGING_BADGE[store.staging.state];
  if (store.staging.state === 'updating' && store.staging.progress) {
    return `${badge.label} ${store.staging.progress.done}/${store.staging.progress.total}`;
  }
  return badge.label;
}

/** Roll an update out to a test (unpublished) theme of several stores. */
export default function Rollout() {
  const [sha, setSha] = useState<string | undefined>(undefined);
  // Chosen test theme per store (numeric theme ID), sent as "domain:id,…".
  const [themeChoice, setThemeChoice] = useState<Record<string, string>>({});
  const themesParam = Object.entries(themeChoice)
    .map(([domain, id]) => `${domain}:${id.split('/').pop()}`)
    .join(',');
  const status = useApiQuery(() => api.rollout.get(sha, themesParam || undefined), [sha, themesParam]);
  const updates = useApiQuery(() => api.updates.list({ perPage: 20 }), [], status.data?.enabled ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<RolloutPreviewResult[] | null>(null);
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const preview = useMutation(api.rollout.preview);
  const confirm = useMutation(api.rollout.confirm);

  const target = status.data?.target ?? null;
  const busy = (status.data?.stores ?? []).some((s) => s.staging.state === 'updating' || s.staging.state === 'queued');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => api.rollout.get(sha, themesParam || undefined).then(status.setData).catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [busy, sha, themesParam, status.setData]);

  if (status.loading && !status.data) return <LoadingState title="Roll out to stores" />;
  const data = status.data;

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const check = async () => {
    if (!target) return;
    const targets = (data?.stores ?? [])
      .filter((s) => selected.has(s.shopDomain) && s.themeId)
      .map((s) => ({ shopDomain: s.shopDomain, themeId: s.themeId! }));
    const results = await preview.run({ sha: target.sha, targets });
    if (results) {
      setPreviews(results);
      setReplace(new Set());
    }
  };

  const ready = (previews ?? []).filter(
    (p) => p.run && !p.run.actions.blockedByCodeErrors && (!p.run.actions.needsDirectEditApproval || replace.has(p.shopDomain)),
  );

  const start = async () => {
    const results = await confirm.run({
      runs: ready.map((p) => ({ shopDomain: p.shopDomain, runId: p.run!.id, acceptDirectEdits: replace.has(p.shopDomain) || undefined })),
    });
    if (results) {
      const failed = results.filter((r) => r.error);
      showToast(failed.length ? `${failed.length} store(s) could not start` : 'Roll-out started', { isError: failed.length > 0 });
      setPreviews(null);
      setSelected(new Set());
      status.reload();
    }
  };

  return (
    <AppLayout
      title="Roll out to stores"
      subtitle="Change it once. It ships to every store."
      secondaryActions={[{ content: 'Refresh', onAction: status.reload, loading: status.loading }]}
      banners={
        <>
          <ErrorBanner error={status.error} onRetry={status.reload} />
          <ErrorBanner error={preview.error ?? confirm.error} onDismiss={preview.clearError} />
        </>
      }
    >
      {data && !data.enabled && (
        <s-banner tone="info" heading="Roll-out is not set up">
          <s-paragraph>
            List the stores of the collection in the Worker variable STORE_GROUP (comma-separated *.myshopify.com domains) to
            roll an update out to several stores from one screen. Until then, update each store from its own Theme Sync.
          </s-paragraph>
        </s-banner>
      )}

      {data?.enabled && (
        <>
          <s-section heading="Update">
            <s-stack gap="base">
              <s-select
                label="Update to roll out"
                value={target?.sha ?? 'none'}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSha(/^[0-9a-f]{40}$/.test(value) ? value : undefined);
                  setPreviews(null);
                }}
              >
                {!target && <s-option value="none">Choose an update</s-option>}
                {target && !(updates.data?.items ?? []).some((i) => i.sha === target.sha) && (
                  <s-option value={target.sha}>{`${target.shortSha} ${firstLine(target.message)}`}</s-option>
                )}
                {(updates.data?.items ?? []).map((item) => (
                  <s-option key={item.sha} value={item.sha}>{`${item.shortSha} ${firstLine(item.message)}`}</s-option>
                ))}
              </s-select>
              <s-paragraph color="subdued">
                The update goes to the test (unpublished) theme you choose for each store. Each store then tests it and
                publishes it to its Live theme from that store&apos;s Theme Sync — one store at a time, so a launch can be
                staged brand by brand.
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading="Stores">
            <s-stack gap="base">
              <s-table>
                <s-table-header-row>
                  <s-table-header>Roll out</s-table-header>
                  <s-table-header listSlot="primary">Store</s-table-header>
                  <s-table-header>Test theme</s-table-header>
                  <s-table-header listSlot="inline">Test theme status</s-table-header>
                  <s-table-header listSlot="secondary">Live</s-table-header>
                  <s-table-header>Open</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.stores.map((store) => {
                    const selectable = !!target && ['behind', 'failed', 'ahead'].includes(store.staging.state);
                    const live = LIVE_BADGE[store.live.state];
                    return (
                      <s-table-row key={store.shopDomain}>
                        <s-table-cell>
                          <s-checkbox
                            label={`Roll out to ${store.name}`}
                            labelAccessibilityVisibility="exclusive"
                            checked={selected.has(store.shopDomain)}
                            disabled={!selectable}
                            onChange={() => {
                              toggle(selected, store.shopDomain, setSelected);
                              setPreviews(null);
                            }}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <s-text type="strong">{store.name}</s-text>
                        </s-table-cell>
                        <s-table-cell>
                          {store.themes.length > 0 ? (
                            <s-select
                              label={`Test theme for ${store.name}`}
                              labelAccessibilityVisibility="exclusive"
                              value={store.themeId ?? store.themes[0]!.id}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setThemeChoice((prev) => ({ ...prev, [store.shopDomain]: value }));
                                setPreviews(null);
                              }}
                            >
                              {store.themes.map((t) => (
                                <s-option key={t.id} value={t.id}>
                                  {t.name}
                                </s-option>
                              ))}
                            </s-select>
                          ) : (
                            <s-text color="subdued">—</s-text>
                          )}
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge tone={STAGING_BADGE[store.staging.state].tone}>{stagingLabel(store)}</s-badge>
                        </s-table-cell>
                        <s-table-cell>{live ? <s-badge tone={live.tone}>{live.label}</s-badge> : <s-text color="subdued">—</s-text>}</s-table-cell>
                        <s-table-cell>
                          {!store.current && (
                            <s-button variant="tertiary" onClick={() => redirectTopLevel(store.adminUrl)}>
                              Open ↗
                            </s-button>
                          )}
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
              <s-text color="subdued">The roll-out screen shows where every store stands, so you always know which brands are live on which update.</s-text>
              <s-stack direction="inline" justifyContent="end">
                <s-button variant="primary" disabled={selected.size === 0 || !target} loading={preview.pending} onClick={check}>
                  {`Check ${plural(selected.size, 'store')}`}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>

          {previews && (
            <s-section heading="Review the roll-out">
              <s-stack gap="base">
                {previews.map((p) => (
                  <s-box key={p.shopDomain} border="base" borderRadius="base" padding="base">
                    <s-stack gap="small-200">
                      <s-text type="strong">{p.name}</s-text>
                      {p.error && <s-text tone="critical">{p.error.message}</s-text>}
                      {p.run && (
                        <>
                          <s-stack direction="inline" gap="small-200">
                            <s-badge tone="success">{`${p.run.totals.added} new`}</s-badge>
                            <s-badge tone="caution">{`${p.run.totals.updated} updated`}</s-badge>
                            <s-badge tone="critical">{`${p.run.totals.removed} removed`}</s-badge>
                            <s-badge tone="neutral">Protected files untouched</s-badge>
                          </s-stack>
                          <s-text color="subdued">
                            {`From ${p.run.base?.shortSha ?? 'no update'} · ${plural(p.run.commits.length, 'update')} included`}
                          </s-text>
                          {p.run.actions.blockedByCodeErrors && (
                            <s-text tone="critical">
                              {`Code check found ${plural(p.run.checks?.code.issues.length ?? 0, 'error')} — this store is skipped.`}
                            </s-text>
                          )}
                          {p.run.actions.needsDirectEditApproval && (
                            <s-checkbox
                              label={`Replace ${plural(p.run.checks?.directEdits.files.length ?? 0, 'file')} edited directly in Shopify`}
                              details={(p.run.checks?.directEdits.files ?? []).map((f) => f.path).join(', ')}
                              checked={replace.has(p.shopDomain)}
                              onChange={() => toggle(replace, p.shopDomain, setReplace)}
                            />
                          )}
                          {!p.run.actions.blockedByCodeErrors && !p.run.actions.needsDirectEditApproval && (
                            <s-text tone="success">✓ Checks passed</s-text>
                          )}
                        </>
                      )}
                    </s-stack>
                  </s-box>
                ))}
                <s-stack direction="inline" gap="small-200" justifyContent="end">
                  <s-button onClick={() => setPreviews(null)}>Cancel</s-button>
                  <s-button variant="primary" disabled={ready.length === 0} loading={confirm.pending} onClick={start}>
                    {`Update the test theme on ${plural(ready.length, 'store')}`}
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          )}
        </>
      )}
    </AppLayout>
  );
}
