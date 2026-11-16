import React from 'react';
import PropTypes from 'prop-types';

const Stack = ({
                   children,
                   // Accessibility
                   accessibilityLabel,
                   accessibilityRole = 'generic',
                   accessibilityVisibility = 'visible',
                   // Stack Layout
                   direction = 'block',
                   gap = 'none',
                   columnGap = '',
                   rowGap = '',
                   // Alignment
                   justifyContent = 'normal',
                   alignContent = 'normal',
                   alignItems = 'normal',
                   // Sizing
                   blockSize = 'auto',
                   inlineSize = 'auto',
                   minBlockSize = '0',
                   minInlineSize = '0',
                   maxBlockSize = 'none',
                   maxInlineSize = 'none',
                   // Styling
                   background = 'transparent',
                   border = 'none',
                   borderColor = '',
                   borderRadius = 'none',
                   borderStyle = '',
                   borderWidth = '',
                   // Padding
                   padding = 'none',
                   paddingBlock = '',
                   paddingBlockStart = '',
                   paddingBlockEnd = '',
                   paddingInline = '',
                   paddingInlineStart = '',
                   paddingInlineEnd = '',
                   // Other
                   display = 'auto',
                   overflow = 'visible',
                   ...otherProps
               }) => {
    return (
        <s-stack
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            accessibilityVisibility={accessibilityVisibility}
            direction={direction}
            gap={gap}
            columnGap={columnGap}
            rowGap={rowGap}
            justifyContent={justifyContent}
            alignContent={alignContent}
            alignItems={alignItems}
            blockSize={blockSize}
            inlineSize={inlineSize}
            minBlockSize={minBlockSize}
            minInlineSize={minInlineSize}
            maxBlockSize={maxBlockSize}
            maxInlineSize={maxInlineSize}
            background={background}
            border={border}
            borderColor={borderColor}
            borderRadius={borderRadius}
            borderStyle={borderStyle}
            borderWidth={borderWidth}
            padding={padding}
            paddingBlock={paddingBlock}
            paddingBlockStart={paddingBlockStart}
            paddingBlockEnd={paddingBlockEnd}
            paddingInline={paddingInline}
            paddingInlineStart={paddingInlineStart}
            paddingInlineEnd={paddingInlineEnd}
            display={display}
            overflow={overflow}
            {...otherProps}
        >
            {children}
        </s-stack>
    );
};

Stack.propTypes = {
    children: PropTypes.node,
    // Accessibility
    accessibilityLabel: PropTypes.string,
    accessibilityRole: PropTypes.oneOf([
        'main', 'header', 'footer', 'section', 'aside', 'navigation',
        'ordered-list', 'list-item', 'list-item-separator', 'unordered-list',
        'separator', 'status', 'alert', 'generic', 'presentation', 'none'
    ]),
    accessibilityVisibility: PropTypes.oneOf(['visible', 'hidden', 'exclusive']),
    // Stack Layout
    direction: PropTypes.oneOfType([
        PropTypes.oneOf(['inline', 'block']),
        PropTypes.string // for responsive values
    ]),
    gap: PropTypes.oneOfType([
        PropTypes.oneOf([
            'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for two-value syntax or responsive values
    ]),
    columnGap: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for responsive values
    ]),
    rowGap: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for responsive values
    ]),
    // Alignment
    justifyContent: PropTypes.oneOfType([
        PropTypes.oneOf([
            'normal', 'center', 'start', 'end',
            'space-between', 'space-around', 'space-evenly', 'stretch'
        ]),
        PropTypes.string // for complex values like 'unsafe start', 'safe center'
    ]),
    alignContent: PropTypes.oneOfType([
        PropTypes.oneOf([
            'normal', 'center', 'start', 'end',
            'space-between', 'space-around', 'space-evenly', 'stretch',
            'baseline', 'first baseline', 'last baseline'
        ]),
        PropTypes.string // for complex values
    ]),
    alignItems: PropTypes.oneOfType([
        PropTypes.oneOf([
            'normal', 'stretch', 'center', 'start', 'end',
            'baseline', 'first baseline', 'last baseline'
        ]),
        PropTypes.string // for complex values
    ]),
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
    // Styling
    background: PropTypes.oneOf(['transparent', 'subdued', 'base', 'strong']),
    border: PropTypes.oneOfType([
        PropTypes.oneOf(['none']),
        PropTypes.string // for border shorthand syntax
    ]),
    borderColor: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'subdued', 'base', 'strong']),
        PropTypes.string
    ]),
    borderRadius: PropTypes.oneOfType([
        PropTypes.oneOf([
            'none', 'small', 'small-100', 'small-200', 'base',
            'large', 'large-100', 'large-200'
        ]),
        PropTypes.string // for multi-value syntax
    ]),
    borderStyle: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'auto', 'none', 'solid', 'dashed']),
        PropTypes.string // for multi-value syntax
    ]),
    borderWidth: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'none', 'small', 'small-100', 'base', 'large', 'large-100']),
        PropTypes.string // for multi-value syntax
    ]),
    // Padding
    padding: PropTypes.oneOfType([
        PropTypes.oneOf([
            'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for multi-value syntax or responsive values
    ]),
    paddingBlock: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for two-value syntax or responsive values
    ]),
    paddingBlockStart: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for responsive values
    ]),
    paddingBlockEnd: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for responsive values
    ]),
    paddingInline: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for two-value syntax or responsive values
    ]),
    paddingInlineStart: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for responsive values
    ]),
    paddingInlineEnd: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string // for responsive values
    ]),
    // Other
    display: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', 'none']),
        PropTypes.string // for responsive values
    ]),
    overflow: PropTypes.oneOf(['visible', 'hidden']),
};

export default Stack;