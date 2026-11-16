import React from "react";
import PropTypes from "prop-types";

const DatePicker = ({
                        name,
                        type = "single",
                        value,
                        defaultValue,
                        view,
                        defaultView,

                        allow,
                        allowDays,
                        disallow,
                        disallowDays,

                        // Events
                        onBlur,
                        onChange,
                        onFocus,
                        onInput,
                        onViewChange,

                        ...rest
                    }) => {
    return (
        <s-date-picker
            name={name}
            type={type}
            value={value}
            defaultValue={defaultValue}
            view={view}
            defaultView={defaultView}
            allow={allow}
            allowDays={allowDays}
            disallow={disallow}
            disallowDays={disallowDays}
            onBlur={onBlur}
            onChange={onChange}
            onFocus={onFocus}
            onInput={onInput}
            onViewchange={onViewChange}
            {...rest}
        />
    );
};

DatePicker.propTypes = {
    /** Identifier */
    name: PropTypes.string,

    /** Type of picker */
    type: PropTypes.oneOf(["single", "range"]),

    /** Value management */
    value: PropTypes.string,
    defaultValue: PropTypes.string,

    /** Current month shown */
    view: PropTypes.string,        // YYYY-MM
    defaultView: PropTypes.string, // YYYY-MM

    /** Allow rules */
    allow: PropTypes.string,
    allowDays: PropTypes.string,

    /** Disallow rules */
    disallow: PropTypes.string,
    disallowDays: PropTypes.string,

    /** Events */
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onInput: PropTypes.func,
    onViewChange: PropTypes.func,
};

export default DatePicker;


//Single Date Picker (basic)
// <DatePicker
//     type="single"
//     value="2025-05-10"
//     view="2025-05"
// />

//Range Picker
// <DatePicker
//     type="range"
//     view="2025-05"
//     value="2025-05-28--2025-05-31"
// />

