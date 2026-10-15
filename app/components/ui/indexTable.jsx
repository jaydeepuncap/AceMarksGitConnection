import React, { Fragment, useState } from 'react';

import PropTypes from 'prop-types';
import { Box, Button, Chip, ClickableChip, Grid, Icon, Popover, SearchField, Stack } from './';

// Main Table Component
const Table = ({
    children,
    activeFilters = [],
    appliedFilters = [],
    columns = [],
    rows = [],
    emptyState,
    bulkActions = [],
    queryData = {},
    sortData = {},
    clearAllFiltersData = {},
    loading = false,
    loadingLength = 10,
    customLoading = false,
    customLoadingRows = [],
    isQueryField = false,
    isSortField = false,
    isShowBulkActions = false,
    isShowSelectedFilters = false,
    isDisabledFilters = false,
    ...restProps
}) => {
    const [showFilters, setShowFilters] = useState(false);
    const DISABLE_FILTERS = isDisabledFilters;
    const safeClearAllFiltersData = clearAllFiltersData || {};

    const onHandleShowFilters = () => {
        setShowFilters(!showFilters);
    };

    const hasHeaderActions =
        (isShowSelectedFilters && (appliedFilters && appliedFilters.length > 0)) ||
        isQueryField ||
        isSortField ||
        showFilters ||
        isShowBulkActions;

    return (
        <Stack gap="small">
            <Stack gap="small-200" paddingBlockStart={hasHeaderActions ? "base" : "none"}>
                {
                    (isShowSelectedFilters && (appliedFilters && appliedFilters.length > 0)) ? (
                        <div className="index-table-selected-filters">
                            <Stack direction="inline" gap="small-300" justifyContent="start" paddingBlockStart="small-200" paddingInline="base" alignItems="center">
                                {(appliedFilters || []).map((x, index) => {
                                    return (
                                        <Fragment key={index}>
                                            <ClickableChip
                                                color="strong"
                                                accessibilityLabel="Remove status filter"
                                                removable
                                                onClick={(e) => { e.stopPropagation(); x.onRemove(); }}
                                                onRemove={(e) => { e.stopPropagation(); x.onRemove(); }}
                                            >
                                                {x.label}
                                            </ClickableChip>
                                        </Fragment>
                                    )
                                })}

                                {safeClearAllFiltersData.onClick && (
                                    <ClickableChip
                                        color="strong"
                                        accessibilityLabel={safeClearAllFiltersData.accessibilityLabel || "Clear All"}
                                        removable
                                        onClick={(e) => { e.stopPropagation(); safeClearAllFiltersData.onClick(); }}
                                        onRemove={(e) => { e.stopPropagation(); safeClearAllFiltersData.onClick(); }}
                                        disabled={safeClearAllFiltersData.disabled || loading || false}
                                        variant={safeClearAllFiltersData.variant || "secondary"}
                                        icon={safeClearAllFiltersData.icon || "close"}
                                        tone={safeClearAllFiltersData.tone || "primary"}
                                    >
                                        {safeClearAllFiltersData.label || "Clear All"}
                                    </ClickableChip>
                                )}
                            </Stack>
                        </div>
                    ) : null
                }

                {(isQueryField || isSortField) && (
                    <Grid gap="small-200" gridTemplateColumns="1fr auto" paddingInline='base'>
                        {isQueryField && (
                            <SearchField
                                label={queryData?.label || "Search products"}
                                labelAccessibilityVisibility={queryData?.labelAccessibilityVisibility || "exclusive"}
                                icon={queryData?.icon || "search"}
                                placeholder={queryData?.placeholder || "Search all products"}
                                value={queryData?.value || ""}
                                onChange={(e) => queryData?.onChange ? queryData.onChange(e?.target?.value) : (() => { })}
                                onInput={(e) => queryData?.onChange ? queryData.onChange(e?.target?.value) : (() => { })}
                                onClear={() => queryData?.onClear ? queryData.onClear() : (() => { })}
                                disabled={queryData?.disabled || DISABLE_FILTERS || false}
                            />
                        )}

                        <Stack direction="inline" gap="small-300" justifyContent="end">
                            {activeFilters && activeFilters.length > 0 ? (showFilters ? (
                                <Button icon="x-circle" variant="secondary" accessibilityLabel="Filter" onClick={() => {
                                    onHandleShowFilters();
                                    safeClearAllFiltersData.onClick && safeClearAllFiltersData.onClick();
                                }}
                                    disabled={DISABLE_FILTERS || false} >
                                    Cancel
                                </Button>
                            ) : (
                                <Button icon="search" variant="secondary" accessibilityLabel="Filter" onClick={onHandleShowFilters} disabled={DISABLE_FILTERS || false} >
                                    <Icon type="filter" />
                                </Button>
                            )) : null}

                            {isSortField && (
                                <Fragment>
                                    <Button commandFor={`sort-${sortData.key}-popover`} disabled={sortData.disabled || loading || DISABLE_FILTERS || false} variant="secondary" icon="sort" />

                                    <Popover id={`sort-${sortData.key}-popover`} disabled={sortData.disabled || loading || DISABLE_FILTERS || false}>
                                        <Box blockSize="auto" inlineSize="auto">
                                            {sortData.sortOptions || null}
                                        </Box>
                                    </Popover>
                                </Fragment>
                            )}
                        </Stack>
                    </Grid>
                )}

                {(showFilters || isShowBulkActions) ? (
                    <Stack direction='inline' gap='small-300' justifyContent='space-between' paddingInline='base' alignItems='center'>
                        {showFilters ? (activeFilters && activeFilters.length > 0) && (
                            <div className="index-table-filters">
                                <Stack direction="inline" gap="small-300" justifyContent="start">
                                    {(activeFilters || []).map((x, index) => (
                                        <Fragment key={index}>
                                            <Button commandFor={`filter-${x.key}-popover`} disabled={x.disabled || loading || DISABLE_FILTERS || false} variant="secondary">
                                                {x.label}
                                                <Icon type="chevron-down" size="small" />
                                            </Button>

                                            <Popover id={`filter-${x.key}-popover`} disabled={x.disabled || loading || DISABLE_FILTERS || false}>
                                                <Box blockSize="auto" inlineSize="auto" padding="small">
                                                    {x.filter || null}
                                                </Box>
                                            </Popover>
                                        </Fragment>
                                    ))}
                                </Stack>
                            </div>
                        ) :
                            <Box>&nbsp;</Box>
                        }

                        {
                            (isShowBulkActions && (bulkActions && bulkActions.length > 0)) ? (
                                <div className="index-table-promoted-bulk-actions">
                                    <Stack direction="inline" gap="small-300" justifyContent="end">
                                        {(bulkActions || []).map((action, index) => {
                                            return (
                                                <Fragment key={index}>
                                                    <Button
                                                        onClick={(e) => { e.stopPropagation(); action.onAction(); }}
                                                        disabled={action.disabled || loading || DISABLE_FILTERS || false}
                                                        variant={action.variant || "secondary"}
                                                        tone={action.tone || (action.destructive ? 'critical' : 'auto')}
                                                        {...action}
                                                    >
                                                        {action.content || action.label}
                                                    </Button>
                                                </Fragment>
                                            )
                                        })}
                                    </Stack>
                                </div>
                            ) : null
                        }
                    </Stack>
                ) : ''}

                {loading ? (
                    <Stack gap="base">
                        <s-table>
                            {(columns && columns.length > 0) && (
                                <s-table-header-row>
                                    {(columns || []).map((column, index) => (
                                        <s-table-header key={column.id || index} listSlot={column.listSlot} format={column.format} id={column.id}>
                                            <Stack direction="inline" padding={column.padding || "none"} alignItems={column.alignItems || "start"} justifyContent={column.format === 'numeric' ? 'end' : (column.justifyContent || "start")} alignContent={column.alignContent || "start"}>
                                                {column.title}
                                            </Stack>
                                        </s-table-header>
                                    ))}
                                </s-table-header-row>
                            )}
                            <s-table-body>
                                {customLoading ? (customLoadingRows) : (
                                    <>
                                        {Array.from({ length: loadingLength }).map((_, index) => {
                                            return (
                                                <s-table-row key={index}>
                                                    {columns && columns.map((column, i) => {
                                                        return (
                                                            <s-table-cell key={i}>
                                                                <Stack direction="inline" padding={column.padding || "none"} alignItems={column.alignItems || "start"} justifyContent={column.justifyContent || "start"} alignContent={column.alignContent || "start"}>
                                                                    <Chip size="small"><div style={{ width: 70, height: 6 }}>&nbsp;</div></Chip>
                                                                </Stack>
                                                            </s-table-cell>
                                                        )
                                                    })}
                                                </s-table-row>
                                            )
                                        })}
                                    </>

                                )}

                            </s-table-body>
                        </s-table>
                    </Stack>
                ) : (
                    <s-table {...restProps}>
                        {(columns && columns.length > 0) && (
                            <s-table-header-row>
                                {columns.map((column, index) => (
                                    <s-table-header key={column.id || index} listSlot={column.listSlot} format={column.format} id={column.id}>
                                        <Stack direction="inline" padding={column.padding || "none"} alignItems={column.alignItems || "start"} justifyContent={column.format === 'numeric' ? 'end' : (column.justifyContent || "start")} alignContent={column.alignContent || "start"}>
                                            {column.title}
                                        </Stack>
                                    </s-table-header>
                                ))}
                            </s-table-header-row>
                        )}

                        {(rows && rows.length > 0) ? (
                            <s-table-body>
                                {rows}
                            </s-table-body>
                        ) : ''}
                    </s-table>
                )}
            </Stack>

            {(rows && rows.length === 0 && !loading && emptyState) ? (
                <div style={{ display: 'flex', justifyContent: 'center', width: '-webkit-fill-available', background: '#FFFFFF' }}>
                    {emptyState}
                </div>
            ) : ''}
        </Stack >
    );
};

Table.propTypes = {
    children: PropTypes.node,
    activeFilters: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string,
        filter: PropTypes.node,
        key: PropTypes.string,
        label: PropTypes.string,
        onRemove: PropTypes.func,
        pinned: PropTypes.bool,
        disabled: PropTypes.bool,
    })),
    columns: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string,
        title: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
        listSlot: PropTypes.oneOf(['primary', 'secondary']),
        format: PropTypes.oneOf(['numeric']),
    })),
    rows: PropTypes.arrayOf(PropTypes.node),
    bulkActions: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string,
        variant: PropTypes.oneOf(['primary', 'secondary', 'tertiary', 'destructive']),
        tone: PropTypes.oneOf(['primary', 'secondary', 'tertiary', 'destructive']),
        content: PropTypes.string.isRequired,
        onAction: PropTypes.func.isRequired,
        destructive: PropTypes.bool,
        disabled: PropTypes.bool,
        icon: PropTypes.string,
        label: PropTypes.string,
        href: PropTypes.string,
        target: PropTypes.string,
        rel: PropTypes.string,
    })),
    selectedFilters: PropTypes.object,
    queryData: PropTypes.object,
    sortData: PropTypes.object,
    loading: PropTypes.bool,
    isQueryField: PropTypes.bool,
    isSortField: PropTypes.bool,
    isShowBulkActions: PropTypes.bool,
    isShowSelectedFilters: PropTypes.bool,
};

// Table Header Row Component
const TableHeaderRow = ({
    children,
    ...otherProps
}) => {
    return (
        <s-table-header-row {...otherProps}>
            {children}
        </s-table-header-row>
    );
};

TableHeaderRow.propTypes = {
    children: PropTypes.node.isRequired,
};

// Table Header Component
const TableHeader = ({
    children,
    listSlot,
    format,
    ...otherProps
}) => {
    return (
        <s-table-header
            listSlot={listSlot}
            format={format}
            {...otherProps}
        >
            {children}
        </s-table-header>
    );
};

TableHeader.propTypes = {
    children: PropTypes.node.isRequired,
    listSlot: PropTypes.oneOf(['primary', 'secondary']),
    format: PropTypes.oneOf(['numeric']),
};

// Table Body Component
const TableBody = ({
    children,
    ...otherProps
}) => {
    return (
        <s-table-body {...otherProps}>
            {children}
        </s-table-body>
    );
};

TableBody.propTypes = {
    children: PropTypes.node.isRequired,
};

// Table Row Component
// Table Row Component - Add drag and drop props
const TableRow = ({
    children,
    clickDelegate,
    // Add these new props
    draggable = false,
    onDragStart = null,
    onDragOver = null,
    onDrop = null,
    onDragLeave = null,
    'data-position': dataPosition,
    className = '',
    ...otherProps
}) => {
    const handleDragStart = (e) => {
        if (onDragStart) {
            onDragStart(e);
        }
    };

    const handleDragOver = (e) => {
        if (onDragOver) {
            e.preventDefault();
            onDragOver(e);
        }
    };

    const handleDrop = (e) => {
        if (onDrop) {
            onDrop(e);
        }
    };

    const handleDragLeave = (e) => {
        if (onDragLeave) {
            onDragLeave(e);
        }
    };

    return (
        <s-table-row
            clickDelegate={clickDelegate}
            draggable={draggable}
            onDragStart={draggable ? handleDragStart : undefined}
            onDragOver={draggable ? handleDragOver : undefined}
            onDrop={draggable ? handleDrop : undefined}
            onDragLeave={draggable ? handleDragLeave : undefined}
            data-position={dataPosition}
            className={className}
            {...otherProps}
        >
            {children}
        </s-table-row>
    );
};

TableRow.propTypes = {
    children: PropTypes.node.isRequired,
    clickDelegate: PropTypes.string,
    // Add these prop types
    draggable: PropTypes.bool,
    onDragStart: PropTypes.func,
    onDragOver: PropTypes.func,
    onDrop: PropTypes.func,
    onDragLeave: PropTypes.func,
    'data-position': PropTypes.number,
    className: PropTypes.string,
};

// Table Cell Component
const TableCell = ({
    children,
    ...otherProps
}) => {
    return (
        <s-table-cell {...otherProps}>
            {children}
        </s-table-cell>
    );
};

TableCell.propTypes = {
    children: PropTypes.node,
};

// Export all components
export {
    Table, TableBody, TableCell, TableHeader, TableHeaderRow, TableRow
};

// Default export
export default Table;


// <Section padding="none" accessibilityLabel="Products table">
//     <Table
//         filters={
//             <Grid gap="small-200" gridTemplateColumns="1fr auto">
//                 <TextField
//                     label="Search products"
//                     labelAccessibilityVisibility="exclusive"
//                     icon="search"
//                     placeholder="Search all products"
//                 />
//                 <Button
//                     icon="sort"
//                     variant="secondary"
//                     accessibilityLabel="Sort"
//                     commandFor="sort-actions"
//                 />
//             </Grid>
//         }
//     >
//         <TableHeaderRow>
//             <TableHeader listSlot="primary">Product</TableHeader>
//             <TableHeader format="numeric">Price</TableHeader>
//             <TableHeader>Status</TableHeader>
//             <TableHeader listSlot="secondary">Actions</TableHeader>
//         </TableHeaderRow>
//
//         <TableBody>
//             <TableRow clickDelegate="product-1-checkbox">
//                 <TableCell>
//                     <Stack direction="inline" gap="small" alignItems="center">
//                         <Checkbox id="product-1-checkbox" />
//                         <Link href="/products/1">Mountain View Puzzle</Link>
//                     </Stack>
//                 </TableCell>
//                 <TableCell>$29.99</TableCell>
//                 <TableCell>
//                     <Badge color="base" tone="success">Active</Badge>
//                 </TableCell>
//                 <TableCell>
//                     <Button variant="tertiary">Edit</Button>
//                 </TableCell>
//             </TableRow>
//
//             <TableRow clickDelegate="product-2-checkbox">
//                 <TableCell>
//                     <Stack direction="inline" gap="small" alignItems="center">
//                         <Checkbox id="product-2-checkbox" />
//                         <Link href="/products/2">Ocean Sunset Puzzle</Link>
//                     </Stack>
//                 </TableCell>
//                 <TableCell>$24.99</TableCell>
//                 <TableCell>
//                     <Badge color="base" tone="neutral">Draft</Badge>
//                 </TableCell>
//                 <TableCell>
//                     <Button variant="tertiary">Edit</Button>
//                 </TableCell>
//             </TableRow>
//         </TableBody>
//     </Table>
// </Section>


// With thumbnail images:
// <TableCell>
//     <Stack direction="inline" gap="small" alignItems="center">
//     <Checkbox id="item-checkbox" />
//     <Clickable
// href="/item"
// border="base"
// borderRadius="base"
// overflow="hidden"
// inlineSize="40px"
// blockSize="40px"
//     >
//     <Image objectFit="cover" src="image.jpg" />
//     </Clickable>
// <Link href="/item">Item Name</Link>
// </Stack>
// </TableCell>
//
// With status badges:
//   <TableCell>
//     <Badge color="base" tone="success">Active</Badge>
// </TableCell>