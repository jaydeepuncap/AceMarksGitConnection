import React from 'react';
import PropTypes from 'prop-types';

const Spinner = ({accessibilityLabel="Loading", size="base", }) => {
    return (
        <s-spinner accessibilityLabel={accessibilityLabel} size={size} />
    );
};
Spinner.propTypes = {

    size: PropTypes.oneOf(['base', 'large', 'large-100']),

    accessibilityLabel: PropTypes.string,
};
export default Spinner;