import React from 'react';
import PropTypes from 'prop-types';

const Popover = ({
                     children,
                     id,
                     // Sizing
                     blockSize = 'auto',
                     inlineSize = 'auto',
                     minBlockSize = '0',
                     minInlineSize = '0',
                     maxBlockSize = 'none',
                     maxInlineSize = 'none',
                     // Event handlers
                     onShow,
                     onHide,
                     onToggle,
                     onAfterShow,
                     onAfterHide,
                     onAfterToggle,
                     ...otherProps
                 }) => {
    return (
        <s-popover
            id={id}
            blockSize={blockSize}
            inlineSize={inlineSize}
            minBlockSize={minBlockSize}
            minInlineSize={minInlineSize}
            maxBlockSize={maxBlockSize}
            maxInlineSize={maxInlineSize}
            onShow={onShow}
            onHide={onHide}
            onToggle={onToggle}
            onAfterShow={onAfterShow}
            onAfterHide={onAfterHide}
            onAfterToggle={onAfterToggle}
            {...otherProps}
        >
            {children}
        </s-popover>
    );
};

Popover.propTypes = {
    children: PropTypes.node,
    id: PropTypes.string.isRequired,
    // Sizing
    blockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', '0']),
        PropTypes.string // for px or % values
    ]),
    inlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', '0']),
        PropTypes.string // for px or % values
    ]),
    minBlockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['0']),
        PropTypes.string // for px or % values
    ]),
    minInlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['0']),
        PropTypes.string // for px or % values
    ]),
    maxBlockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['none', '0']),
        PropTypes.string // for px or % values
    ]),
    maxInlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['none', '0']),
        PropTypes.string // for px or % values
    ]),
    // Event handlers
    onShow: PropTypes.func,
    onHide: PropTypes.func,
    onToggle: PropTypes.func,
    onAfterShow: PropTypes.func,
    onAfterHide: PropTypes.func,
    onAfterToggle: PropTypes.func,
};

export default Popover;


// <>
//     <Button commandFor="product-options-popover">
//         Product options
//     </Button>
//     <Popover id="product-options-popover">
//         <Stack>
//             <Button variant="tertiary">Import</Button>
//             <Button variant="tertiary">Export</Button>
//         </Stack>
//     </Popover>
// </>
//
// // Popover with custom sizing
// <>
//     <Button commandFor="notifications-popover" icon="notification">
//         Notifications
//     </Button>
//     <Popover
//         id="notifications-popover"
//         maxInlineSize="400px"
//         onShow={() => console.log('Popover opened')}
//         onHide={() => console.log('Popover closed')}
//     >
//         <Box padding="base">
//             <Stack gap="small-200">
//                 <Text>Notification content here</Text>
//             </Stack>
//         </Box>
//     </Popover>
// </>
