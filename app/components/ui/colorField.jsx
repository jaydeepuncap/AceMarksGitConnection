import React from "react";
import PropTypes from "prop-types";

const ColorField = ({
    id,
    name,
    label,
    details,
    placeholder,
    value,
    defaultValue,
    autocomplete = "on",
    alpha = true,
    disabled,
    readOnly,
    required,
    error,
    labelAccessibilityVisibility = "visible",
    onBlur,
    onChange,
    onFocus,
    onInput,
    requiredIndicator,
    ...rest
}) => {
    return (
        <s-color-field
            id={id}
            name={name}
            label={label}
            details={details}
            placeholder={placeholder}
            value={value}
            defaultValue={defaultValue}
            autocomplete={autocomplete}
            alpha={alpha}
            disabled={disabled}
            readOnly={readOnly}
            required={required || requiredIndicator}
            error={error}
            labelAccessibilityVisibility={labelAccessibilityVisibility}
            onBlur={onBlur}
            onChange={onChange}
            onFocus={onFocus}
            onInput={onInput}
            {...rest}
        />
    );
};

ColorField.propTypes = {
    /** Identification */
    id: PropTypes.string,
    name: PropTypes.string,

    /** Label system */
    label: PropTypes.string,
    details: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Input behavior */
    placeholder: PropTypes.string,
    value: PropTypes.string,
    defaultValue: PropTypes.string,
    autocomplete: PropTypes.oneOf(["on", "off"]),

    /** Color options */
    alpha: PropTypes.bool,

    /** Field state */
    disabled: PropTypes.bool,
    readOnly: PropTypes.bool,
    required: PropTypes.bool,
    error: PropTypes.string,

    /** Events */
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onInput: PropTypes.func,
};

export default ColorField;
