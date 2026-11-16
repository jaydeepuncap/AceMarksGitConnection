import React from "react";
import PropTypes from "prop-types";

const SearchField = ({
                         id,
                         name,
                         label,
                         labelAccessibilityVisibility = "visible",
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

                         // events
                         onBlur,
                         onChange,
                         onFocus,
                         onInput,

                         ...rest
                     }) => {
    return (
        <s-search-field
            id={id}
            name={name}
            label={label}
            labelAccessibilityVisibility={labelAccessibilityVisibility}
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
            onBlur={onBlur}
            onChange={onChange}
            onFocus={onFocus}
            onInput={onInput}
            {...rest}
        />
    );
};

SearchField.propTypes = {
    /** Identity */
    id: PropTypes.string,
    name: PropTypes.string,

    /** Label / Details */
    label: PropTypes.string,
    details: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Input / Values */
    placeholder: PropTypes.string,
    value: PropTypes.string,
    defaultValue: PropTypes.string,

    /** Behavior / Rules */
    autocomplete: PropTypes.string,
    maxLength: PropTypes.number,
    minLength: PropTypes.number,
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

export default SearchField;
