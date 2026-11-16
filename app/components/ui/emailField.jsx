import React from "react";
import PropTypes from "prop-types";

const EmailField = ({
                        id,
                        name,
                        label,
                        details,
                        placeholder,
                        value,
                        defaultValue,
                        autocomplete = "on",
                        maxLength,
                        minLength,
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
        <s-email-field
            id={id}
            name={name}
            label={label}
            details={details}
            placeholder={placeholder}
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

EmailField.propTypes = {
    /** Identification */
    id: PropTypes.string,
    name: PropTypes.string,

    /** Label & details */
    label: PropTypes.string,
    details: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Input behavior */
    placeholder: PropTypes.string,
    autocomplete: PropTypes.string,

    /** Values */
    value: PropTypes.string,
    defaultValue: PropTypes.string,

    /** Constraints */
    maxLength: PropTypes.number,
    minLength: PropTypes.number,
    required: PropTypes.bool,

    /** State */
    disabled: PropTypes.bool,
    readOnly: PropTypes.bool,
    error: PropTypes.string,

    /** Events */
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onInput: PropTypes.func,
};

export default EmailField;
