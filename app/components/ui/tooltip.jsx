import React from 'react';
import PropTypes from 'prop-types';

const Tooltip = ({
                     children,
                     id,
                     ...otherProps
                 }) => {
    return (
        <s-tooltip
            id={id}
            {...otherProps}
        >
            {children}
        </s-tooltip>
    );
};

Tooltip.propTypes = {
    children: PropTypes.node.isRequired,
    id: PropTypes.string.isRequired,
};

export default Tooltip;

// Simple text tooltip:
//
//     <>
//         <Tooltip id="bold-tooltip">Bold</Tooltip>
//         <Button interestFor="bold-tooltip" accessibilityLabel="Bold">
//             B
//         </Button>
//     </>

//Tooltip with Text component:
// <>
//     <Tooltip id="shipping-status-tooltip">
//         <Text>This order has shipping labels.</Text>
//     </Tooltip>
//     <Text interestFor="shipping-status-tooltip">Shipping status</Text>
// </>

//Tooltip on icon button:
// <>
//     <Tooltip id="delete-button-tooltip">
//         <Text>Delete item permanently</Text>
//     </Tooltip>
//     <Button interestFor="delete-button-tooltip">
//         <Icon tone="neutral" type="info" />
//     </Button>
// </>