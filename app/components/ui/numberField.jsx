import React from "react";
import PropTypes from "prop-types";

const NumberField = ({
                         id,
                         name,
                         label,
                         details,
                         placeholder,
                         value,
                         defaultValue,
                         autocomplete = "on",
                         inputMode = "decimal",
                         max,
                         min,
                         step = 1,
                         prefix,
                         suffix,
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
        <s-number-field
            id={id}
            name={name}
            label={label}
            details={details}
            placeholder={placeholder}
            value={value}
            defaultValue={defaultValue}
            autocomplete={autocomplete}
            inputMode={inputMode}
            max={max}
            min={min}
            step={step}
            prefix={prefix}
            suffix={suffix}
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

NumberField.propTypes = {
    /** Identification */
    id: PropTypes.string,
    name: PropTypes.string,

    /** Content */
    label: PropTypes.string,
    details: PropTypes.string,
    placeholder: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Values */
    value: PropTypes.string,
    defaultValue: PropTypes.string,

    /** Limits */
    max: PropTypes.number,
    min: PropTypes.number,
    step: PropTypes.number,

    /** Prefix/Suffix */
    prefix: PropTypes.string,
    suffix: PropTypes.string,

    /** Input behavior */
    autocomplete: PropTypes.string,
    inputMode: PropTypes.oneOf(["decimal", "numeric"]),

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

export default NumberField;
