import React from 'react';
import PropTypes from 'prop-types';

const Clickable = ({
                       children,
                       // Accessibility
                       accessibilityLabel,
                       accessibilityRole = 'generic',
                       accessibilityVisibility = 'visible',
                       // Link & Navigation
                       href,
                       target = 'auto',
                       download,
                       // Commands
                       command = '--auto',
                       commandFor,
                       interestFor,
                       // State
                       disabled = false,
                       loading = false,
                       type = 'button',
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
                       // Events
                       onClick,
                       onFocus,
                       onBlur,
                       ...otherProps
                   }) => {
    return (
        <s-clickable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            accessibilityVisibility={accessibilityVisibility}
            href={href}
            target={target}
            download={download}
            command={command}
            commandFor={commandFor}
            interestFor={interestFor}
            disabled={disabled}
            loading={loading}
            type={type}
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
            onClick={onClick}
            onFocus={onFocus}
            onBlur={onBlur}
            {...otherProps}
        >
            {children}
        </s-clickable>
    );
};

Clickable.propTypes = {
    children: PropTypes.node.isRequired,
    // Accessibility
    accessibilityLabel: PropTypes.string,
    accessibilityRole: PropTypes.oneOf([
        'main', 'header', 'footer', 'section', 'aside', 'navigation',
        'ordered-list', 'list-item', 'list-item-separator', 'unordered-list',
        'separator', 'status', 'alert', 'generic', 'presentation', 'none'
    ]),
    accessibilityVisibility: PropTypes.oneOf(['visible', 'hidden', 'exclusive']),
    // Link & Navigation
    href: PropTypes.string,
    target: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', '_blank', '_self', '_parent', '_top']),
        PropTypes.string
    ]),
    download: PropTypes.string,
    // Commands
    command: PropTypes.oneOf(['--auto', '--show', '--hide', '--toggle']),
    commandFor: PropTypes.string,
    interestFor: PropTypes.string,
    // State
    disabled: PropTypes.bool,
    loading: PropTypes.bool,
    type: PropTypes.oneOf(['button', 'reset', 'submit']),
    // Sizing
    blockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', '0']),
        PropTypes.string
    ]),
    inlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', '0']),
        PropTypes.string
    ]),
    minBlockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['0']),
        PropTypes.string
    ]),
    minInlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['0']),
        PropTypes.string
    ]),
    maxBlockSize: PropTypes.oneOfType([
        PropTypes.oneOf(['none', '0']),
        PropTypes.string
    ]),
    maxInlineSize: PropTypes.oneOfType([
        PropTypes.oneOf(['none', '0']),
        PropTypes.string
    ]),
    // Styling
    background: PropTypes.oneOf(['transparent', 'subdued', 'base', 'strong']),
    border: PropTypes.oneOfType([
        PropTypes.oneOf(['none']),
        PropTypes.string
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
        PropTypes.string
    ]),
    borderStyle: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'auto', 'none', 'solid', 'dashed']),
        PropTypes.string
    ]),
    borderWidth: PropTypes.oneOfType([
        PropTypes.oneOf(['', 'none', 'small', 'small-100', 'base', 'large', 'large-100']),
        PropTypes.string
    ]),
    // Padding
    padding: PropTypes.oneOfType([
        PropTypes.oneOf([
            'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    paddingBlock: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    paddingBlockStart: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    paddingBlockEnd: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    paddingInline: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    paddingInlineStart: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    paddingInlineEnd: PropTypes.oneOfType([
        PropTypes.oneOf([
            '', 'none', 'small-500', 'small-400', 'small-300', 'small-200', 'small-100',
            'small', 'base', 'large', 'large-100', 'large-200', 'large-300',
            'large-400', 'large-500'
        ]),
        PropTypes.string
    ]),
    // Other
    display: PropTypes.oneOfType([
        PropTypes.oneOf(['auto', 'none']),
        PropTypes.string
    ]),
    overflow: PropTypes.oneOf(['visible', 'hidden']),
    // Events
    onClick: PropTypes.func,
    onFocus: PropTypes.func,
    onBlur: PropTypes.func,
};

export default Clickable;

//Basic clickable card:
// <Clickable padding="base">
//     Create Store
// </Clickable>

// Styled clickable:
//     <Clickable
//         border="base"
//         padding="base"
//         background="subdued"
//         borderRadius="base"
//         onClick={() => console.log('Clicked!')}
//     >
//         View Shipping Settings
//     </Clickable>
//
// Submit button:
//     <Clickable
//         type="submit"
//         disabled
//         border="base"
//         padding="base"
//     >
//         Save changes
//     </Clickable>
//
// External link:
//     <Clickable
//         href="https://www.shopify.com"
//         target="_blank"
//     >
//         Visit Shopify
//     </Clickable>
//
// Command trigger:
//     <Clickable
//         commandFor="settings-modal"
//         command="--show"
//         border="base"
//         padding="base"
//         borderRadius="small"
//     >
//         Open Settings
//     </Clickable>
//
// Card with clickable action:
//     <Box padding="large-400" background="base" borderRadius="small-200">
//         <Stack gap="large-300">
//             <Heading>Product settings</Heading>
//             <Text>Configure your product inventory and pricing settings.</Text>
//             <Clickable
//                 background="base"
//                 padding="base"
//                 borderRadius="small"
//                 onClick={() => navigate('/settings')}
//             >
//                 <Text type="strong">Configure settings</Text>
//             </Clickable>
//         </Stack>
//     </Box>
//
// Disabled clickable with accessibility:
//
// <Clickable
//     href="/feature"
//     disabled
//     accessibilityLabel="This link is currently unavailable"
//     border="base"
//     padding="base"
// >
//     <Text>Unavailable feature</Text>
// </Clickable>
//
// Loading state:
//     <Clickable
//         loading
//         padding="base"
//         border="base"
//         borderRadius="base"
//     >
//         Processing...
//     </Clickable>
//
// With tooltip:
//     <>
//         <Tooltip id="info-tooltip">
//             <Text>Click for more information</Text>
//         </Tooltip>
//         <Clickable
//             interestFor="info-tooltip"
//             border="base"
//             padding="base"
//             borderRadius="base"
//         >
//             <Icon type="info" />
//         </Clickable>
//     </>