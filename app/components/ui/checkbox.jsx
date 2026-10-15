import React from "react";
import PropTypes from "prop-types";

const Checkbox = ({
                      id,
                      name,
                      label,
                      details,
                      value,
                      checked,
                      defaultChecked,
                      indeterminate,
                      defaultIndeterminate,
                      required,
                      disabled,
                      error,
                      accessibilityLabel,
                      onChange,
                      onInput,
                      ...rest
                  }) => {
    return (
        <s-checkbox
            id={id || name}
            name={name}
            label={label}
            details={details}
            value={value}
            checked={checked}
            defaultChecked={defaultChecked}
            indeterminate={indeterminate}
            defaultIndeterminate={defaultIndeterminate}
            required={required}
            disabled={disabled}
            error={error}
            accessibilityLabel={accessibilityLabel}
            onChange={onChange}
            onInput={onInput}
            {...rest}
        />
    );
};

Checkbox.propTypes = {
    /** Accessible alternative label */
    accessibilityLabel: PropTypes.string,

    /** Input core props */
    id: PropTypes.string,
    name: PropTypes.string,
    value: PropTypes.string,

    /** Label + hint text */
    label: PropTypes.string,
    details: PropTypes.string,
    error: PropTypes.string,

    /** State */
    checked: PropTypes.bool,
    defaultChecked: PropTypes.bool,
    indeterminate: PropTypes.bool,
    defaultIndeterminate: PropTypes.bool,
    disabled: PropTypes.bool,
    required: PropTypes.bool,

    /** Events */
    onChange: PropTypes.func,
    onInput: PropTypes.func,
};

export default Checkbox;
