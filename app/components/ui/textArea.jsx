import React from "react";
import PropTypes from "prop-types";

const TextArea = ({
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
                      rows,
                      value,
                      onBlur,
                      onChange,
                      onFocus,
                      onInput,
                      children,
                      requiredIndicator,
                      multiLine,
                      ...rest
                  }) => {
    return (
        <s-text-area
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
            required={required || requiredIndicator}
            rows={rows || multiLine}
            value={value}
            onBlur={onBlur}
            onChange={onChange}
            onFocus={onFocus}
            onInput={onInput}
            {...rest}
        >
            {children}
        </s-text-area>
    );
};

TextArea.propTypes = {
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
    rows: PropTypes.number,
    value: PropTypes.string,
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onInput: PropTypes.func,
    children: PropTypes.node,
};

export default TextArea;
