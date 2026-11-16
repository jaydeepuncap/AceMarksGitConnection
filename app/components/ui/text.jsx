import React from 'react';
import PropTypes from 'prop-types';

const Text = ({
    children,
    color = 'base',
    tone = 'auto',
    type = 'generic',
    accessibilityVisibility = 'visible',
    dir = '',
    fontVariantNumeric = 'auto',
    interestFor,
    ...restProps
}) => {
    return (
        <s-text
            color={color}
            tone={tone}
            type={type}
            accessibilityVisibility={accessibilityVisibility}
            dir={dir}
            fontVariantNumeric={fontVariantNumeric}
            interestFor={interestFor}
            {...restProps}
        >
            {children}
        </s-text>
    );
};

Text.propTypes = {
    children: PropTypes.node,
    dangerouslySetInnerHTML: PropTypes.objectOf(PropTypes.string),
    color: PropTypes.oneOf(['base', 'subdued']),
    tone: PropTypes.oneOf(['info', 'success', 'warning', 'critical', 'auto', 'neutral', 'caution']),
    type: PropTypes.oneOf(['strong', 'generic', 'address', 'redundant']),
    accessibilityVisibility: PropTypes.oneOf(['visible', 'hidden', 'exclusive']),
    dir: PropTypes.oneOf(['', 'auto', 'ltr', 'rtl']),
    fontVariantNumeric: PropTypes.oneOf(['auto', 'normal', 'tabular-nums']),
    interestFor: PropTypes.string,
};

export default Text;