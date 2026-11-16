import React from "react";

import PropTypes from "prop-types";
import { Text } from "./";

const ChoiceList = ({
    label,
    details,
    name,
    id,
    disabled,
    error,
    multiple,
    values,
    labelAccessibilityVisibility = "visible",
    choices = [],
    onChange,
    onInput,
    ...rest
}) => {
    return (
        <s-choice-list
            label={label}
            details={details}
            name={name}
            id={id || name}
            disabled={disabled}
            error={error}
            multiple={multiple}
            values={values}
            labelAccessibilityVisibility={labelAccessibilityVisibility}
            onChange={onChange}
            onInput={onInput || onChange}
            {...rest}
        >
            {choices.map((choice, index) => (
                <s-choice key={index} value={choice.value} disabled={choice.disabled}>
                    {typeof choice.label === "string" ? (
                        <Text slot="label">{choice.label}</Text>
                    ) : (
                        <div slot="label">{choice.label}</div>
                    )}
                </s-choice>
            ))}
        </s-choice-list>
    );
};

ChoiceList.propTypes = {
    /** Label + details */
    label: PropTypes.string,
    details: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Field control */
    disabled: PropTypes.bool,
    error: PropTypes.string,

    /** Selection behavior */
    name: PropTypes.string,
    multiple: PropTypes.bool,
    values: PropTypes.arrayOf(PropTypes.string),

    /** Choices passed as array */
    choices: PropTypes.arrayOf(
        PropTypes.shape({
            value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
            label: PropTypes.oneOfType([PropTypes.string, PropTypes.node]).isRequired,
            disabled: PropTypes.bool,
        })
    ),

    /** Events */
    onChange: PropTypes.func,
    onInput: PropTypes.func,
};

export default ChoiceList;

// <ChoiceList
//     label="Company name"
//     name="companyName"
//     details="The company name will be displayed on the checkout page."
//     values={selected}
//     onChange={handleChange}
//     choices={[
//         { value: "hidden", label: "Hidden" },
//         { value: "optional", label: "Optional" },
//         { value: "required", label: "Required" },
//     ]}
// />

