import React, { useId } from "react";
import PropTypes from "prop-types";
import Box from "./box";
import Stack from "./stack";
import Text from "./text";
import Icon from "./icon";
import Clickable from "./clickable";
import Popover from "./popover";
import DatePicker from "./datePicker";

const DateField = ({
    id,
    name = "",
    label,
    details,
    placeholder,
    value,
    defaultValue,
    defaultView,
    view,
    allow,
    allowDays,
    disallow,
    disallowDays,
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
    onInvalid,
    onViewChange,

    ...rest
}) => {
    const generatedId = useId();
    const displayValue = value ?? defaultValue ?? "";
    const displayText = displayValue && displayValue.length > 0 ? displayValue : (placeholder || "YYYY-MM-DD");

    const handleSelect = (event) => {
        const nextValue = event?.currentTarget?.value ?? "";
        if (onChange && nextValue) {
            onChange({ target: { value: nextValue, name } });
        }
    };

    return (
        <Box>
            {label && labelAccessibilityVisibility !== "exclusive" && (
                <Box paddingBlockEnd="small-400">
                    <Text>{label}{required ? " *" : ""}</Text>
                </Box>
            )}

            <Clickable
                command="--show"
                commandFor={generatedId}
                disabled={disabled}
                border="base"
                borderColor={error ? "strong" : "base"}
                borderRadius="base"
                padding="small-300"
                background="base"
                display="block"
                onFocus={onFocus}
                onBlur={onBlur}
                onInput={onInput}
                onInvalid={onInvalid}
                {...rest}
            >
                <Stack direction="inline" alignItems="center" gap="small-400">
                    <Icon type="calendar" />
                    <Text color={displayValue ? "base" : "subdued"}>{displayText}</Text>
                </Stack>
            </Clickable>

            <Popover id={generatedId}>
                <Box padding="base">
                    <DatePicker
                        command="--hide"
                        commandFor={generatedId}
                        type="single"
                        value={displayValue}
                        view={view}
                        allow={allow}
                        allowDays={allowDays}
                        disallow={disallow}
                        disallowDays={disallowDays}
                        onChange={handleSelect}
                    />
                </Box>
            </Popover>

            {(details || error) && (
                <Box paddingBlockStart="small-400">
                    {error ? (
                        <Text color="critical">{error}</Text>
                    ) : (
                        <Text color="subdued">{details}</Text>
                    )}
                </Box>
            )}
        </Box>
    );
};

DateField.propTypes = {
    /** Identification */
    id: PropTypes.string,
    name: PropTypes.string,

    /** Labels */
    label: PropTypes.string,
    details: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Value management */
    value: PropTypes.string,
    defaultValue: PropTypes.string,

    /** Month displayed */
    defaultView: PropTypes.string, // YYYY-MM
    view: PropTypes.string,        // YYYY-MM

    /** Allowed & disallowed rules */
    allow: PropTypes.string,
    allowDays: PropTypes.string,
    disallow: PropTypes.string,
    disallowDays: PropTypes.string,

    /** Input behavior */
    placeholder: PropTypes.string,

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
    onInvalid: PropTypes.func,
    onViewChange: PropTypes.func,
};

export default DateField;


// Basic
// <DateField
// defaultView="2025-09"
// defaultValue="2025-09-01"
// label="Select date"
//     />

// With allowed ranges

// <DateField
// label="Delivery date"
// allow="2025-01-01--2025-12-31"
// allowDays="monday, tuesday, wednesday, thursday, friday"
// disallow="2025-06"   // whole month not allowed
// onChange={(e) => console.log(e.detail.value)}
// />

//With view change

// <DateField
//     label="Estimate"
//     defaultView="2025-05"
//     onViewChange={(e) => console.log("Month changed:", e.detail.view)}
// />
