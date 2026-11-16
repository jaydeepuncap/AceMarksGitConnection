import React from 'react';
import PropTypes from 'prop-types';

const Chip = ({
                  children,
                  color = 'base',
                  accessibilityLabel,
                  graphic,
                  ...restProps
              }) => {
    return (
        <s-chip
            color={color}
            accessibilityLabel={accessibilityLabel}
            {...restProps}
        >
            {graphic && (
                <span slot="graphic">
                    {graphic}
                </span>
            )}
            {children}
        </s-chip>
    );
};

Chip.propTypes = {
    children: PropTypes.node.isRequired,
    color: PropTypes.oneOf(['subdued', 'base', 'strong']),
    accessibilityLabel: PropTypes.string,
    graphic: PropTypes.node,
};

export default Chip;

// <Chip
//     color="strong"
//     accessibilityLabel="Verified status"
//     graphic={<Icon type="check" size="small" />}
// >
//     Verified
// </Chip>