import React from 'react';
import PropTypes from 'prop-types';

const Thumbnail = ({
                       src,
                       alt = '',
                       size = 'base',
                       ...restProps
                   }) => {
    return (
        <s-thumbnail
            src={src}
            alt={alt}
            size={size}
            {...restProps}
        />
    );
};

Thumbnail.propTypes = {
    src: PropTypes.string,
    alt: PropTypes.string,
    size: PropTypes.oneOf(['small', 'small-200', 'small-100', 'base', 'large', 'large-100']),
};

export default Thumbnail;