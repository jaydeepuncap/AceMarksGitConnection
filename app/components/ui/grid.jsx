import React from 'react';
import PropTypes from 'prop-types';

// Spacing keywords for padding and gap
const spacingKeywords = [
    'none',
    'small-500',
    'small-400',
    'small-300',
    'small-200',
    'small-100',
    'small',
    'base',
    'large',
    'large-100',
    'large-200',
    'large-300',
    'large-400',
    'large-500'
];

const Grid = ({
    children,
    gridTemplateColumns = 'none',
    gridTemplateRows = 'none',
    gap = 'none',
    rowGap = '',
    columnGap = '',
    alignContent = '',
    alignItems = '',
    justifyContent = '',
    justifyItems = '',
    placeContent = 'normal normal',
    placeItems = 'normal normal',
    padding = 'none',
    paddingBlock = '',
    paddingBlockStart = '',
    paddingBlockEnd = '',
    paddingInline = '',
    paddingInlineStart = '',
    paddingInlineEnd = '',
    background = 'transparent',
    border = 'none',
    borderColor = '',
    borderRadius = 'none',
    borderStyle = '',
    borderWidth = '',
    inlineSize = 'auto',
    blockSize = 'auto',
    minInlineSize = '0',
    minBlockSize = '0',
    maxInlineSize = 'none',
    maxBlockSize = 'none',
    overflow = 'visible',
    display = 'auto',
    accessibilityLabel,
    accessibilityRole = 'generic',
    accessibilityVisibility = 'visible',
    ...restProps
}) => {
    return (
        <s-grid
            gridTemplateColumns={gridTemplateColumns}
            gridTemplateRows={gridTemplateRows}
            gap={gap}
            rowGap={rowGap}
            columnGap={columnGap}
            alignContent={alignContent}
            alignItems={alignItems}
            justifyContent={justifyContent}
            justifyItems={justifyItems}
            placeContent={placeContent}
            placeItems={placeItems}
            padding={padding}
            paddingBlock={paddingBlock}
            paddingBlockStart={paddingBlockStart}
            paddingBlockEnd={paddingBlockEnd}
            paddingInline={paddingInline}
            paddingInlineStart={paddingInlineStart}
            paddingInlineEnd={paddingInlineEnd}
            background={background}
            border={border}
            borderColor={borderColor}
            borderRadius={borderRadius}
            borderStyle={borderStyle}
            borderWidth={borderWidth}
            inlineSize={inlineSize}
            blockSize={blockSize}
            minInlineSize={minInlineSize}
            minBlockSize={minBlockSize}
            maxInlineSize={maxInlineSize}
            maxBlockSize={maxBlockSize}
            overflow={overflow}
            display={display}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            accessibilityVisibility={accessibilityVisibility}
            {...restProps}
        >
            {children}
        </s-grid>
    );
};

Grid.propTypes = {
    children: PropTypes.node,

    // Grid template
    gridTemplateColumns: PropTypes.string,
    gridTemplateRows: PropTypes.string,

    // Gap (spacing between items)
    gap: PropTypes.oneOfType([
        PropTypes.oneOf(spacingKeywords),
        PropTypes.string // for responsive values and shorthand like "base large"
    ]),
    rowGap: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values
    ]),
    columnGap: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values
    ]),

    // Alignment
    alignContent: PropTypes.oneOfType([
        PropTypes.oneOf([
            '',
            'normal',
            'baseline',
            'first baseline',
            'last baseline',
            'space-between',
            'space-around',
            'space-evenly',
            'stretch',
            'center',
            'start',
            'end',
            'unsafe start',
            'unsafe end',
            'unsafe center',
            'safe start',
            'safe end',
            'safe center'
        ]),
        PropTypes.string
    ]),
    alignItems: PropTypes.oneOfType([
        PropTypes.oneOf([
            '',
            'normal',
            'stretch',
            'baseline',
            'first baseline',
            'last baseline',
            'center',
            'start',
            'end',
            'unsafe start',
            'unsafe end',
            'unsafe center',
            'safe start',
            'safe end',
            'safe center'
        ]),
        PropTypes.string
    ]),
    justifyContent: PropTypes.oneOfType([
        PropTypes.oneOf([
            '',
            'normal',
            'space-between',
            'space-around',
            'space-evenly',
            'stretch',
            'center',
            'start',
            'end',
            'unsafe start',
            'unsafe end',
            'unsafe center',
            'safe start',
            'safe end',
            'safe center'
        ]),
        PropTypes.string
    ]),
    justifyItems: PropTypes.oneOfType([
        PropTypes.oneOf([
            '',
            'normal',
            'stretch',
            'baseline',
            'first baseline',
            'last baseline',
            'center',
            'start',
            'end',
            'unsafe start',
            'unsafe end',
            'unsafe center',
            'safe start',
            'safe end',
            'safe center'
        ]),
        PropTypes.string
    ]),
    placeContent: PropTypes.string, // too many combinations, use string
    placeItems: PropTypes.string, // too many combinations, use string

    // Padding
    padding: PropTypes.oneOfType([
        PropTypes.oneOf(spacingKeywords),
        PropTypes.string // for responsive values and shorthand like "base large" or "base large none small"
    ]),
    paddingBlock: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values and shorthand like "base large"
    ]),
    paddingBlockStart: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values
    ]),
    paddingBlockEnd: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values
    ]),
    paddingInline: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values and shorthand like "base large"
    ]),
    paddingInlineStart: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values
    ]),
    paddingInlineEnd: PropTypes.oneOfType([
        PropTypes.oneOf(['', ...spacingKeywords]),
        PropTypes.string // for responsive values
    ]),

    // Background
    background: PropTypes.oneOfType([
        PropTypes.oneOf(['transparent', 'subdued', 'base', 'strong']),
        PropTypes.string
    ]),

    // Border
    border: PropTypes.string, // shorthand like "base subdued dashed"
    borderColor: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'subdued', 'base', 'strong']),
        PropTypes.string
    ]),
    borderRadius: PropTypes.oneOfType([
        PropTypes.oneOf(['small', 'small-200', 'small-100', 'base', 'large', 'large-100', 'large-200', 'none']),
        PropTypes.string // for shorthand like "base large"
    ]),
    borderStyle: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'auto', 'none', 'solid', 'dashed']),
        PropTypes.string // for shorthand
    ]),
    borderWidth: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'small', 'small-100', 'base', 'large', 'large-100', 'none']),
        PropTypes.string // for shorthand
    ]),

    // Size
    inlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['auto']),
        PropTypes.string // for px/% values like "100px" or "50%"
    ]),
    blockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['auto']),
        PropTypes.string // for px/% values like "100px" or "50%"
    ]),
    minInlineSize: PropTypes.string, // px/% values like "0" or "100px"
    minBlockSize: PropTypes.string, // px/% values like "0" or "100px"
    maxInlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['none']),
        PropTypes.string // for px/% values like "100px" or "50%"
    ]),
    maxBlockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['none']),
        PropTypes.string // for px/% values like "100px" or "50%"
    ]),

    // Overflow and display
    overflow: PropTypes.oneOf(['visible', 'hidden']),
    display: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', 'none']),
        PropTypes.string // for responsive values
    ]),

    // Accessibility
    accessibilityLabel: PropTypes.string,
    accessibilityRole: PropTypes.oneOf([
        'main',
        'header',
        'footer',
        'section',
        'aside',
        'navigation',
        'ordered-list',
        'list-item',
        'list-item-separator',
        'unordered-list',
        'separator',
        'status',
        'alert',
        'generic',
        'presentation',
        'none'
    ]),
    accessibilityVisibility: PropTypes.oneOf(['visible', 'hidden', 'exclusive']),
};

export default Grid;