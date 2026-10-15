import React from "react";
import PropTypes from "prop-types";

const Switch = ({
    accessibilityLabel,
    checked,
    defaultChecked,
    details,
    disabled,
    error,
    id,
    label,
    labelAccessibilityVisibility,
    name,
    required,
    value,
    onClick,
    onChange,
    onInput,
    children,
    loading,
    ...rest
}) => {
    return (
        <>
            {loading ? (
                <s-chip><div style={{ width: 32, height: 16 }}>&nbsp;</div></s-chip>
            ) : (
                <s-switch
                    accessibilityLabel={accessibilityLabel}
                    checked={checked}
                    defaultChecked={defaultChecked}
                    details={details}
                    disabled={disabled}
                    error={error}
                    id={id}
                    label={label}
                    labelAccessibilityVisibility={labelAccessibilityVisibility}
                    name={name}
                    required={required}
                    value={value}
                    onChange={onChange || onClick}
                    onInput={onInput}
                    {...rest}
                >
                    {children}
                </s-switch>
            )}
        </>

    );
};

Switch.propTypes = {
    accessibilityLabel: PropTypes.string,
    checked: PropTypes.bool,
    defaultChecked: PropTypes.bool,
    details: PropTypes.string,
    disabled: PropTypes.bool,
    error: PropTypes.string,
    id: PropTypes.string,
    label: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),
    name: PropTypes.string,
    required: PropTypes.bool,
    value: PropTypes.string,
    onChange: PropTypes.func,
    onInput: PropTypes.func,
    children: PropTypes.node,
};

export default Switch;
