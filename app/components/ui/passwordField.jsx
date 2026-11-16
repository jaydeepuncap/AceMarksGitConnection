import React from "react";
import PropTypes from "prop-types";

const PasswordField = ({
                           id,
                           name,
                           label,
                           placeholder,
                           details,
                           value,
                           defaultValue,
                           autocomplete = "on",
                           maxLength,
                           minLength = 0,
                           disabled,
                           readOnly,
                           required,
                           error,
                           labelAccessibilityVisibility = "visible",

                           // Events
                           onBlur,
                           onChange,
                           onFocus,
                           onInput,

                           ...rest
                       }) => {
    return (
        <s-password-field
            id={id}
            name={name}
            label={label}
            placeholder={placeholder}
            details={details}
            value={value}
            defaultValue={defaultValue}
            autocomplete={autocomplete}
            maxLength={maxLength}
            minLength={minLength}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
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

PasswordField.propTypes = {
    /** Identification */
    id: PropTypes.string,
    name: PropTypes.string,

    /** Content */
    label: PropTypes.string,
    placeholder: PropTypes.string,
    details: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Value */
    value: PropTypes.string,
    defaultValue: PropTypes.string,

    /** Rules */
    maxLength: PropTypes.number,
    minLength: PropTypes.number,

    /** Input behavior */
    autocomplete: PropTypes.string,
    readOnly: PropTypes.bool,
    disabled: PropTypes.bool,
    required: PropTypes.bool,

    /** Error */
    error: PropTypes.string,

    /** Events */
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onInput: PropTypes.func,
};

export default PasswordField;
