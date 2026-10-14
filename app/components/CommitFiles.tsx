import { api } from '../lib/api-client';
import { useApiQuery } from '../lib/hooks';
import type { CommitFile, FileChange } from '../lib/types';
import { ErrorBanner } from './ErrorBanner';
import { FileList, type FileListItem } from './FileList';
import { LoadingInline } from './LoadingState';

function toItems(files: CommitFile[]): FileListItem[] {
  const items: FileListItem[] = [];
  for (const file of files) {
    const path = file.themePath ?? file.filename;
    const muted = !!file.themePathError;
    const note = file.themePathError ? 'not a theme file' : undefined;
    const change: FileChange =
      file.status === 'removed' ? 'removed' : file.status === 'added' || file.status === 'copied' ? 'added' : 'modified';
    if (file.status === 'renamed') {
      items.push({ path, change: 'added', note, muted });
      if (file.previousFilename) items.push({ path: file.previousFilename, change: 'removed', note: 'renamed', muted });
    } else if (file.status !== 'unchanged') {
      items.push({ path, change, note, muted });
    }
  }
  return items;
}

/** Files one update (commit) adds, changes or removes — loaded when expanded. */
export function CommitFiles({ sha }: { sha: string }) {
  const files = useApiQuery(() => api.commits.files(sha, { perPage: 300 }), [sha]);
  if (files.loading && !files.data) return <LoadingInline label="Loading files…" />;
  if (files.error) return <ErrorBanner error={files.error} onRetry={files.reload} heading="Files could not be loaded" />;
  const items = toItems(files.data?.items ?? []);
  return (
    <s-stack gap="small-200">
      <FileList files={items} empty="This update changes no files." />
      {files.data?.hasNextPage && <s-text color="subdued">More files are not shown.</s-text>}
    </s-stack>
  );
}
