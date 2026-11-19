import { Button } from './ui';

/**
 * The row action of a sync in every sync list: "View details", or "Retry" (critical) when failed files
 * can be retried. Both open the sync's page.
 */
export function ViewSyncButton({
  run,
  onOpen,
}: {
  run: { id: string; canRetry: boolean; commitSha: string };
  onOpen: () => void;
}) {
  return run.canRetry ? (
    <Button
      variant="secondary"
      tone="critical"
      icon="refresh"
      accessibilityLabel={`Open sync of ${run.commitSha.slice(0, 7)} to retry`}
      onClick={onOpen}
    >
      Retry
    </Button>
  ) : (
    <Button
      variant="secondary"
      icon="view"
      accessibilityLabel={`Open sync of ${run.commitSha.slice(0, 7)}`}
      onClick={onOpen}
    >
      View details
    </Button>
  );
}
