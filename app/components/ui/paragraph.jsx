import React from 'react';
import PropTypes from 'prop-types';

const Paragraph = ({
                       children,
                       color = 'base',
                       tone = 'auto',
                       lineClamp = Infinity,
                       accessibilityVisibility = 'visible',
                       dir = '',
                       fontVariantNumeric = 'auto',
                       ...restProps
                   }) => {
    return (
        <s-paragraph
            color={color}
            tone={tone}
            lineClamp={lineClamp}
            accessibilityVisibility={accessibilityVisibility}
            dir={dir}
            fontVariantNumeric={fontVariantNumeric}
            {...restProps}
        >
            {children}
        </s-paragraph>
    );
};

Paragraph.propTypes = {
    children: PropTypes.node.isRequired,
    color: PropTypes.oneOf(['base', 'subdued']),
    tone: PropTypes.oneOf(['info', 'success', 'warning', 'critical', 'auto', 'neutral', 'caution']),
    lineClamp: PropTypes.number,
    accessibilityVisibility: PropTypes.oneOf(['visible', 'hidden', 'exclusive']),
    dir: PropTypes.oneOf(['', 'auto', 'ltr', 'rtl']),
    fontVariantNumeric: PropTypes.oneOf(['auto', 'normal', 'tabular-nums']),
};

export default Paragraph;