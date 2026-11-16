import React from 'react';
import PropTypes from 'prop-types';

const ClickableChip = ({
                           children,
                           // Accessibility
                           accessibilityLabel,
                           // Styling
                           color = 'base',
                           // State
                           disabled = false,
                           hidden = false,
                           removable = false,
                           // Link & Navigation
                           href,
                           // Commands
                           command = '--auto',
                           commandFor,
                           interestFor,
                           // Slots
                           graphic,
                           // Events
                           onClick,
                           onRemove,
                           onAfterHide,
                           ...otherProps
                       }) => {
    return (
        <s-clickable-chip
            accessibilityLabel={accessibilityLabel}
            color={color}
            disabled={disabled}
            hidden={hidden}
            removable={removable}
            href={href}
            command={command}
            commandFor={commandFor}
            interestFor={interestFor}
            onClick={onClick}
            onRemove={onRemove}
            onAfterHide={onAfterHide}
            {...otherProps}
        >
            {graphic && <div slot="graphic">{graphic}</div>}
            {children}
        </s-clickable-chip>
    );
};

ClickableChip.propTypes = {
    children: PropTypes.node.isRequired,
    // Accessibility
    accessibilityLabel: PropTypes.string,
    // Styling
    color: PropTypes.oneOf(['subdued', 'base', 'strong']),
    // State
    disabled: PropTypes.bool,
    hidden: PropTypes.bool,
    removable: PropTypes.bool,
    // Link & Navigation
    href: PropTypes.string,
    // Commands
    command: PropTypes.oneOf(['--auto', '--show', '--hide', '--toggle']),
    commandFor: PropTypes.string,
    interestFor: PropTypes.string,
    // Slots
    graphic: PropTypes.node,
    // Events
    onClick: PropTypes.func,
    onRemove: PropTypes.func,
    onAfterHide: PropTypes.func,
};

export default ClickableChip;