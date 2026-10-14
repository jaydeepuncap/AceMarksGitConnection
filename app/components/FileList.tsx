import { CHANGE_MARK } from '../lib/format';
import type { FileChange } from '../lib/types';

export interface FileListItem {
  path: string;
  change: FileChange;
  /** Shown on the right (e.g. the update that changed the file, or a status). */
  note?: string;
  muted?: boolean;
}

/** A +/~/− file list, as on the Updates, Review and Publish screens. */
export function FileList({ files, empty = 'No theme files' }: { files: FileListItem[]; empty?: string }) {
  if (files.length === 0) return <s-text color="subdued">{empty}</s-text>;
  return (
    <s-stack gap="small-300">
      {files.map((file) => {
        const mark = CHANGE_MARK[file.change];
        return (
          <s-grid key={`${file.change}:${file.path}`} gridTemplateColumns="1.5rem 1fr auto" gap="small-200" alignItems="center">
            <s-text tone={mark.tone} type="strong" accessibilityVisibility="hidden">
              {mark.mark}
            </s-text>
            <s-text color={file.muted ? 'subdued' : 'base'}>
              {file.path}
              <s-text accessibilityVisibility="exclusive">{` (${mark.label})`}</s-text>
            </s-text>
            <s-text color="subdued">{file.note ?? ''}</s-text>
          </s-grid>
        );
      })}
    </s-stack>
  );
}

/** "+1 ~2 −1" summary. */
export function ChangeCounts({ added, modified, removed }: { added: number; modified: number; removed: number }) {
  const parts: { n: number; change: FileChange }[] = [
    { n: added, change: 'added' },
    { n: modified, change: 'modified' },
    { n: removed, change: 'removed' },
  ];
  const shown = parts.filter((p) => p.n > 0);
  if (shown.length === 0) return <s-text color="subdued">—</s-text>;
  return (
    <s-stack direction="inline" gap="small-200">
      {shown.map((p) => (
        <s-text key={p.change} tone={CHANGE_MARK[p.change].tone}>
          {`${CHANGE_MARK[p.change].mark}${p.n}`}
        </s-text>
      ))}
    </s-stack>
  );
}
