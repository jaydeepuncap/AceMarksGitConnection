import { api } from '../lib/api-client';
import { useApiQuery } from '../lib/hooks';
import type { CommitFile, CommitFileStatus } from '../lib/types';
import type { Tone } from '../lib/format';
import { ErrorBanner } from './ErrorBanner';
import { LoadingInline } from './LoadingState';

const STATUS: Record<CommitFileStatus, { label: string; tone: Tone }> = {
  added: { label: 'Added', tone: 'success' },
  copied: { label: 'Added', tone: 'success' },
  modified: { label: 'Modified', tone: 'caution' },
  changed: { label: 'Modified', tone: 'caution' },
  renamed: { label: 'Renamed', tone: 'info' },
  removed: { label: 'Deleted', tone: 'critical' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
};

/** Files one commit adds, modifies, renames or deletes — loaded when expanded. */
export function CommitFiles({ sha }: { sha: string }) {
  const files = useApiQuery(() => api.commits.files(sha, { perPage: 300 }), [sha]);
  if (files.loading && !files.data) return <LoadingInline label="Loading files…" />;
  if (files.error) return <ErrorBanner error={files.error} onRetry={files.reload} heading="Files could not be loaded" />;
  const items: CommitFile[] = files.data?.items ?? [];
  if (items.length === 0) return <s-text color="subdued">This commit changes no files.</s-text>;
  return (
    <s-stack gap="small-200">
      <s-table variant="list">
        <s-table-header-row>
          <s-table-header listSlot="primary">File</s-table-header>
          <s-table-header listSlot="inline">Status</s-table-header>
          <s-table-header listSlot="secondary">Theme</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {items.map((file) => {
            const status = STATUS[file.status];
            return (
              <s-table-row key={`${file.status}:${file.filename}`}>
                <s-table-cell>
                  <s-text>
                    {file.status === 'renamed' && file.previousFilename ? `${file.previousFilename} → ${file.filename}` : file.filename}
                  </s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={status.tone}>{status.label}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-text color="subdued">{file.themePathError ? 'Not synced: not a theme file' : (file.themePath ?? '')}</s-text>
                </s-table-cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>
      {files.data?.hasNextPage && <s-text color="subdued">More files are not shown.</s-text>}
    </s-stack>
  );
}
