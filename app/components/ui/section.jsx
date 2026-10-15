import React from "react";
import PropTypes from "prop-types";

const Section = ({
                     heading = "",
                     accessibilityLabel = "",
                     padding = "base",
                     children,
                     ...rest
                 }) => {
    const finalAccessibilityLabel =
        heading && !accessibilityLabel ? heading : accessibilityLabel;

    return (
        <s-section
            heading={heading || undefined}
            accessibilityLabel={finalAccessibilityLabel}
            padding={padding}
            {...rest}
        >
            {children}
        </s-section>
    );
};

Section.propTypes = {
    heading: PropTypes.string,
    accessibilityLabel: PropTypes.string,
    padding: PropTypes.oneOf(["base", "none"]),
    children: PropTypes.node,
};

export default Section;
