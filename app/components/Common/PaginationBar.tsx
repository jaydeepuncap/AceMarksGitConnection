import { Button, Select, Stack, Text } from "../ui";

/**
 * Range + page-size pagination. Replaces the legacy `Pagination` component's
 * "Go to page N" NumberField — most list pages don't need direct page jumps,
 * but they do benefit from a visible "X–Y of Z" range and a page-size picker.
 *
 * Driven by zero-based `offset` + `limit` rather than 1-based `page` so the
 * caller's API contract matches the worker routes (which already use offset).
 */

type Props = {
  offset: number;
  limit: number;
  total: number;
  /** Allow merchants to change the page size. Default: [15, 50, 100]. */
  pageSizes?: number[];
  disabled?: boolean;
  onOffsetChange: (next: number) => void;
  onLimitChange?: (next: number) => void;
};

export function PaginationBar({
  offset,
  limit,
  total,
  pageSizes = [15, 50, 100],
  disabled = false,
  onOffsetChange,
  onLimitChange,
}: Props) {
  if (total === 0) return null;

  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = end < total;

  return (
    <Stack
      direction="inline"
      gap="small"
      justifyContent="space-between"
      alignItems="center"
      paddingBlock="small"
      paddingInline="base"
    >
      <Stack direction="inline" gap="small-300" alignItems="center">
        <Text>
          {start}–{end} of {total}
        </Text>
        {onLimitChange && pageSizes.length > 1 ? (
          <Select
            label="Per page"
            labelAccessibilityVisibility="exclusive"
            value={String(limit)}
            disabled={disabled}
            onChange={(e: { target?: { value?: string } }) => {
              const next = Number(e?.target?.value ?? limit);
              if (Number.isFinite(next) && next > 0) {
                onOffsetChange(0); // jump back to the first page when size changes
                onLimitChange(next);
              }
            }}
            options={pageSizes.map((n) => ({
              label: `${n} per page`,
              value: String(n),
            }))}
          />
        ) : null}
      </Stack>

      <Stack direction="inline" gap="small-300" alignItems="center">
        <Button
          icon="arrow-left"
          variant="secondary"
          accessibilityLabel="Previous page"
          disabled={disabled || !hasPrev}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        />
        <Button
          icon="arrow-right"
          variant="secondary"
          accessibilityLabel="Next page"
          disabled={disabled || !hasNext}
          onClick={() => onOffsetChange(offset + limit)}
        />
      </Stack>
    </Stack>
  );
}

export default PaginationBar;
