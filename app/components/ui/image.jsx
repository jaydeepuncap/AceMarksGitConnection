import React from 'react';
import PropTypes from 'prop-types';

const Image = ({
                   src,
                   alt = '',
                   aspectRatio = '',
                   inlineSize = 'fill',
                   objectFit = 'contain',
                   loading = 'eager',
                   border = 'none',
                   borderColor = '',
                   borderRadius = 'none',
                   borderStyle = '',
                   borderWidth = '',
                   accessibilityRole = 'img',
                   sizes,
                   srcSet,
                   ...restProps
               }) => {
    return (
        <s-image
            src={src}
            alt={alt}
            aspectRatio={aspectRatio}
            inlineSize={inlineSize}
            objectFit={objectFit}
            loading={loading}
            border={border}
            borderColor={borderColor}
            borderRadius={borderRadius}
            borderStyle={borderStyle}
            borderWidth={borderWidth}
            accessibilityRole={accessibilityRole}
            sizes={sizes}
            srcSet={srcSet}
            {...restProps}
        />
    );
};

Image.propTypes = {
    src: PropTypes.string,
    alt: PropTypes.string,
    aspectRatio: PropTypes.string,
    inlineSize: PropTypes.oneOf(['auto', 'fill']),
    objectFit: PropTypes.oneOf(['contain', 'cover']),
    loading: PropTypes.oneOf(['eager', 'lazy']),
    border: PropTypes.string,
    borderColor: PropTypes.oneOf(['', 'subdued', 'base', 'strong']),
    borderRadius:  PropTypes.oneOf(['small', 'small-200', 'small-100', 'base', 'large', 'large-100', 'large-200', 'none']),
    borderStyle: PropTypes.oneOf(['', 'auto', 'none', 'solid', 'dashed']),
    borderWidth:PropTypes.oneOf(['', 'small', 'small-100', 'base', 'large', 'large-100', 'none']),
    accessibilityRole: PropTypes.oneOf(['none', 'presentation', 'img']),
    sizes: PropTypes.string,
    srcSet: PropTypes.string,
};

export default Image;