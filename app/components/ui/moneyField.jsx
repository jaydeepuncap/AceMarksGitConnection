import React from "react";
import PropTypes from "prop-types";

const MoneyField = ({
                        id,
                        name,
                        label,
                        details,
                        placeholder,
                        value,
                        defaultValue,
                        autocomplete = "on",
                        max,
                        min,
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
        <s-money-field
            id={id}
            name={name}
            label={label}
            details={details}
            placeholder={placeholder}
            value={value}
            defaultValue={defaultValue}
            autocomplete={autocomplete}
            max={max}
            min={min}
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

MoneyField.propTypes = {
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

    /** Limits */
    max: PropTypes.number,
    min: PropTypes.number,

    /** State */
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

export default MoneyField;
