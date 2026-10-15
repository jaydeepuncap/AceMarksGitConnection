import PropTypes from 'prop-types';
import React from 'react'

const PressButton = ({
    children,
    accessibilityLabel,
    defaultPressed,
    disabled,
    id,
    inlineSize,
    lang,
    loading,
    pressed,
    onClick,
    onFocus,
    onBlur,
    slot,
    ...props
}) => {
    return (
        <s-press-button
            accessibilityLabel={accessibilityLabel}
            defaultPressed={defaultPressed}
            disabled={disabled}
            id={id}
            inlineSize={inlineSize}
            lang={lang}
            loading={loading}
            pressed={pressed}
            onClick={onClick}
            onFocus={onFocus}
            onBlur={onBlur}
            slot={slot}
            {...props}
        >
            {children}
        </s-press-button>
    )
};

PressButton.propTypes = {
    children: PropTypes.node.isRequired,
    accessibilityLabel: PropTypes.string,
    defaultPressed: PropTypes.bool,
    disabled: PropTypes.bool,
    id: PropTypes.string,
    inlineSize: PropTypes.string,
    lang: PropTypes.string,
    loading: PropTypes.bool,
    pressed: PropTypes.bool,
    onClick: PropTypes.func,
    onFocus: PropTypes.func,
    onBlur: PropTypes.func,
    slot: PropTypes.string,
};

export default PressButton