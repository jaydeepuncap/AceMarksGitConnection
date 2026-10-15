import React from "react";
import PropTypes from "prop-types";

const UrlField = ({
                      autocomplete,
                      defaultValue,
                      details,
                      disabled,
                      error,
                      id,
                      label,
                      labelAccessibilityVisibility,
                      maxLength,
                      minLength,
                      name,
                      placeholder,
                      readOnly,
                      required,
                      value,

                      onBlur,
                      onChange,
                      onFocus,
                      onInput,

                      children,
                      ...rest
                  }) => {
    return (
        <s-url-field
            autocomplete={autocomplete}
            defaultValue={defaultValue}
            details={details}
            disabled={disabled}
            error={error}
            id={id}
            label={label}
            labelAccessibilityVisibility={labelAccessibilityVisibility}
            maxLength={maxLength}
            minLength={minLength}
            name={name}
            placeholder={placeholder}
            readOnly={readOnly}
            required={required}
            value={value}
            onBlur={onBlur}
            onChange={onChange}
            onFocus={onFocus}
            onInput={onInput}
            {...rest}
        >
            {children}
        </s-url-field>
    );
};

UrlField.propTypes = {
    /** AUTOCOMPLETE HUGE UNION */
    autocomplete: PropTypes.string,

    defaultValue: PropTypes.string,
    details: PropTypes.string,
    disabled: PropTypes.bool,
    error: PropTypes.string,
    id: PropTypes.string,
    label: PropTypes.string,

    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    maxLength: PropTypes.number,
    minLength: PropTypes.number,

    name: PropTypes.string,
    placeholder: PropTypes.string,
    readOnly: PropTypes.bool,
    required: PropTypes.bool,

    value: PropTypes.string,

    /** EVENTS */
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onInput: PropTypes.func,

    children: PropTypes.node,
};

export default UrlField;
