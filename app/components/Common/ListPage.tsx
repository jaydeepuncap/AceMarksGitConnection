import React from "react";
import { Page, Section, Stack } from "../ui";
import EmptyData from "./EmptyData";
import PaginationBar from "./PaginationBar";

/**
 * Shell for resource-list pages (Categories / Designs / Filters). Wires the
 * existing primitives together so individual pages stop reimplementing the
 * same toolbar / empty state / pagination scaffolding.
 *
 * The IndexTable wrapper already handles search/filter/bulk-action UI — this
 * component just lifts the cross-cutting pieces (Page heading, primary /
 * secondary actions, breadcrumb, empty-state, pagination) into one place.
 *
 * Usage:
 *   <ListPage
 *     heading="Categories"
 *     primaryAction={{ label: "Create category", onClick: openCreate }}
 *     secondaryAction={[
 *       { label: "Import", onClick: openImport },
 *       { label: "Export", onClick: downloadCsv },
 *     ]}
 *     loading={loading}
 *     total={total}
 *     offset={offset}
 *     limit={limit}
 *     onOffsetChange={setOffset}
 *     onLimitChange={setLimit}
 *     emptyState={
 *       <EmptyData title="No categories yet">
 *         <Button onClick={openCreate}>Create your first category</Button>
 *       </EmptyData>
 *     }
 *     filteredEmptyState={
 *       <EmptyData title="No results for these filters">
 *         <Button onClick={clearFilters}>Clear filters</Button>
 *       </EmptyData>
 *     }
 *     hasFilters={Boolean(query || categoryIds.length)}
 *     table={
 *       <IndexTable
 *         columns={...}
 *         rows={...}
 *         queryData={...}
 *         isQueryField
 *         loading={loading}
 *       />
 *     }
 *   />
 */

type PageAction = {
  key?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: string;
  tone?: string;
};

type Props = {
  heading: string;
  breadcrumbAction?: { label: string; onClick: () => void; href?: string };
  primaryAction?: PageAction;
  secondaryAction?: PageAction[];

  /** Render the IndexTable yourself — gives the caller full control over
   *  columns, row markup, filter UI, and bulk actions. */
  table: React.ReactNode;

  /** Pagination wiring. Omit when the list isn't paginated. */
  total?: number;
  offset?: number;
  limit?: number;
  onOffsetChange?: (next: number) => void;
  onLimitChange?: (next: number) => void;
  pageSizes?: number[];

  /** Empty-state variants. `filteredEmptyState` renders when `hasFilters`
   *  and zero rows match; otherwise the first-run `emptyState` shows. */
  loading?: boolean;
  rowCount?: number;
  hasFilters?: boolean;
  emptyState?: React.ReactNode;
  filteredEmptyState?: React.ReactNode;
};

export function ListPage({
  heading,
  breadcrumbAction,
  primaryAction,
  secondaryAction,
  table,
  total,
  offset = 0,
  limit = 15,
  onOffsetChange,
  onLimitChange,
  pageSizes,
  loading = false,
  rowCount,
  hasFilters = false,
  emptyState,
  filteredEmptyState,
}: Props) {
  const showEmpty =
    !loading &&
    typeof rowCount === "number" &&
    rowCount === 0 &&
    (emptyState || filteredEmptyState);
  const empty = hasFilters
    ? (filteredEmptyState ?? emptyState)
    : emptyState;

  return (
    <Page
      heading={heading}
      breadcrumbAction={breadcrumbAction}
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    >
      {/* padding="none" so the IndexTable's own toolbar padding is the only
          inline padding — otherwise the table content sits inside a doubled
          gutter (Section base padding + IndexTable toolbar padding) and the
          table feels visibly narrower than the page. */}
      <Section padding="none">
        <Stack gap="base">
          {table}

          {showEmpty ? <>{empty}</> : null}

          {total !== undefined && total > 0 && onOffsetChange ? (
            <PaginationBar
              total={total}
              offset={offset}
              limit={limit}
              disabled={loading}
              onOffsetChange={onOffsetChange}
              onLimitChange={onLimitChange}
              pageSizes={pageSizes}
            />
          ) : null}
        </Stack>
      </Section>
    </Page>
  );
}

export default ListPage;

// Re-export the empty-state component so callers can import everything they
// need from one place: `import { ListPage, EmptyData } from "../components/Common/ListPage";`
export { EmptyData };
