import React from "react";
import PropTypes from "prop-types";

const Divider = ({
                      color = "base",
                      direction = "inline",
                      ...rest
                  }) => {
    return (
        <s-divider
            color={color}
            direction={direction}
            {...rest}
        />
    );
};

Divider.propTypes = {
    color: PropTypes.oneOf(["base", "strong"]),
    direction: PropTypes.oneOf(["inline", "block"]),
};

export default Divider;
