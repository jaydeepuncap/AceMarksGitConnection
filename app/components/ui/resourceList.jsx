import React from 'react';
import PropTypes from 'prop-types';

// Main ResourceList Component
const ResourceList = ({
                          children,
                          filterControls,
                          appliedFilters,
                          sortOptions,
                          sortValue,
                          selectionLabel,
                          actionButton,
                          ...otherProps
                      }) => {
    return (
        <s-section padding="none" {...otherProps}>
            <s-stack gap="small-200">
                {/* Filter Controls Row */}
                {filterControls && (
                    <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="base"
                        alignItems="center"
                        paddingInline="base"
                        paddingBlockStart="base"
                    >
                        {filterControls}
                        {actionButton}
                    </s-grid>
                )}

                {/* Applied Filters Row */}
                {appliedFilters && appliedFilters.length > 0 && (
                    <s-stack
                        direction="inline"
                        gap="small-400"
                        paddingInline="base"
                    >
                        {appliedFilters}
                    </s-stack>
                )}

                {/* Selection and Sort Row */}
                {(selectionLabel || sortOptions) && (
                    <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="base"
                        alignItems="center"
                        paddingInline="base"
                    >
                        {selectionLabel && (
                            <s-checkbox label={selectionLabel} />
                        )}
                        {sortOptions && (
                            <s-select value={sortValue}>
                                {sortOptions}
                            </s-select>
                        )}
                    </s-grid>
                )}

                {/* Resource Items */}
                <s-stack>
                    {children}
                </s-stack>
            </s-stack>
        </s-section>
    );
};

ResourceList.propTypes = {
    children: PropTypes.node.isRequired,
    filterControls: PropTypes.node,
    appliedFilters: PropTypes.arrayOf(PropTypes.node),
    sortOptions: PropTypes.node,
    sortValue: PropTypes.string,
    selectionLabel: PropTypes.string,
    actionButton: PropTypes.node,
};

// ResourceItem Component
const ResourceItem = ({
                          children,
                          id,
                          selected,
                          onSelect,
                          actions,
                          ...otherProps
                      }) => {
    return (
        <s-clickable
            borderStyle="solid none none none"
            border="base"
            paddingInline="base"
            paddingBlock="small"
            {...otherProps}
        >
            <s-grid
                gridTemplateColumns="1fr auto"
                gap="base"
                alignItems="center"
            >
                <s-stack direction="inline" gap="small" alignItems="center">
                    {onSelect && (
                        <s-checkbox
                            id={id}
                            checked={selected}
                            onChange={onSelect}
                        />
                    )}
                    {children}
                </s-stack>
                {actions}
            </s-grid>
        </s-clickable>
    );
};

ResourceItem.propTypes = {
    children: PropTypes.node.isRequired,
    id: PropTypes.string,
    selected: PropTypes.bool,
    onSelect: PropTypes.func,
    actions: PropTypes.node,
};

// Export components
export { ResourceList, ResourceItem };
export default ResourceList;



// <ResourceList
//     filterControls={
//         <Grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
//             <TextField
//                 icon="search"
//                 placeholder="Filter customers"
//             />
//             <Button commandFor="tagged-with">Tagged with</Button>
//             <Popover id="tagged-with">
//                 <Stack gap="small-200" padding="small-200">
//                     <TextField value="VIP" placeholder="Add tag" />
//                     <Link href="">Clear</Link>
//                 </Stack>
//             </Popover>
//         </Grid>
//     }
//     appliedFilters={[
//         <ClickableChip key="vip" removable>Tagged with VIP</ClickableChip>
//     ]}
//     sortOptions={
//         <>
//             <s-option value="newest">Newest update</s-option>
//             <s-option value="oldest">Oldest update</s-option>
//         </>
//     }
//     sortValue="newest"
//     selectionLabel="Showing 2 customers"
//     actionButton={
//         <Button variant="secondary">Save</Button>
//     }
// >
//     <ResourceItem
//         id="customer-1"
//         selected={false}
//         onSelect={() => console.log('Selected')}
//         actions={
//             <Button
//                 icon="menu-horizontal"
//                 variant="tertiary"
//                 accessibilityLabel="Actions for Mae Jemison"
//             />
//         }
//     >
//         <s-avatar />
//         <Stack>
//             <s-heading>Mae Jemison</s-heading>
//             <s-text>Decatur, USA</s-text>
//         </Stack>
//     </ResourceItem>
//
//     <ResourceItem
//         id="customer-2"
//         selected={false}
//         onSelect={() => console.log('Selected')}
//         actions={
//             <Button
//                 icon="menu-horizontal"
//                 variant="tertiary"
//                 accessibilityLabel="Actions for Ellen Ochoa"
//             />
//         }
//     >
//         <s-avatar />
//         <Stack>
//             <s-heading>Ellen Ochoa</s-heading>
//             <s-text>Los Angeles, USA</s-text>
//         </Stack>
//     </ResourceItem>
// </ResourceList>

// Complete Example with State Management:
// import React, { useState } from 'react';
// import { ResourceList, ResourceItem } from './ResourceList';
//
// const CustomerList = () => {
//     const [selectedItems, setSelectedItems] = useState([]);
//     const [filters, setFilters] = useState(['VIP']);
//     const [sortBy, setSortBy] = useState('newest');
//
//     const customers = [
//         { id: '1', name: 'Mae Jemison', location: 'Decatur, USA' },
//         { id: '2', name: 'Ellen Ochoa', location: 'Los Angeles, USA' }
//     ];
//
//     const handleSelect = (id) => {
//         setSelectedItems(prev =>
//             prev.includes(id)
//                 ? prev.filter(i => i !== id)
//                 : [...prev, id]
//         );
//     };
//
//     return (
//         <ResourceList
//             filterControls={
//                 <Grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
//                     <TextField
//                         icon="search"
//                         placeholder="Filter customers"
//                     />
//                     <Button commandFor="tagged-with">Tagged with</Button>
//                 </Grid>
//             }
//             appliedFilters={
//                 filters.map(filter => (
//                     <ClickableChip
//                         key={filter}
//                         removable
//                         onRemove={() => setFilters(prev => prev.filter(f => f !== filter))}
//                     >
//                         Tagged with {filter}
//                     </ClickableChip>
//                 ))
//             }
//             sortOptions={
//                 <>
//                     <s-option value="newest">Newest update</s-option>
//                     <s-option value="oldest">Oldest update</s-option>
//                 </>
//             }
//             sortValue={sortBy}
//             selectionLabel={`Showing ${customers.length} customers`}
//             actionButton={<Button variant="secondary">Save</Button>}
//         >
//             {customers.map(customer => (
//                 <ResourceItem
//                     key={customer.id}
//                     id={customer.id}
//                     selected={selectedItems.includes(customer.id)}
//                     onSelect={() => handleSelect(customer.id)}
//                     actions={
//                         <Button
//                             icon="menu-horizontal"
//                             variant="tertiary"
//                             accessibilityLabel={`Actions for ${customer.name}`}
//                         />
//                     }
//                 >
//                     <s-avatar />
//                     <Stack>
//                         <s-heading>{customer.name}</s-heading>
//                         <s-text>{customer.location}</s-text>
//                     </Stack>
//                 </ResourceItem>
//             ))}
//         </ResourceList>
//     );
// };