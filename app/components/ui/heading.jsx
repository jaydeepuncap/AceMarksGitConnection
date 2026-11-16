import React from "react";
import PropTypes from "prop-types";

const Heading = ({
    children,
    lineClamp = Infinity,
    level = "h4",
    interestFor,
    accessibilityRole = "heading",
    accessibilityVisibility = "visible",
    ...restProps
}) => {
    return (
        <s-heading
            lineClamp={lineClamp}
            accessibilityRole={accessibilityRole}
            accessibilityVisibility={accessibilityVisibility}
            level={level}
            interestFor={interestFor}
            {...restProps}
        >
            {/* {level === "h1" ? (
                <h1 style={{ margin: '0px'}}> {children} </h1>
            ) : level === "h2" ? (
                <h2 style={{ margin: '0px'}}> {children} </h2>
            ) : level === "h3" ? (
                <h3 style={{ margin: '0px'}}> {children} </h3>
            ) : level === "h4" ? (
                <h4 style={{ margin: '0px'}}> {children} </h4>
            ) : level === "h5" ? (
                <h5 style={{ margin: '0px'}}> {children} </h5>
            ) : level === "h6" ? (
                <h6 style={{ margin: '0px'}}> {children} </h6>
            ) : (
                children
            )} */}
            {children}
        </s-heading>
    );
};

Heading.propTypes = {
    children: PropTypes.node.isRequired,
    lineClamp: PropTypes.number,
    level: PropTypes.oneOf(["h1", "h2", "h3", "h4", "h5", "h6"]),
    accessibilityRole: PropTypes.oneOf(["none", "presentation", "heading"]),
    accessibilityVisibility: PropTypes.oneOf(["visible", "hidden", "exclusive"]),
    interestFor: PropTypes.string,
};

export default Heading;