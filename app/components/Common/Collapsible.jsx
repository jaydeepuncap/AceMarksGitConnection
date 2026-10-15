import React from "react";
import PropTypes from "prop-types";
import Stack from "../ui/stack";

const Collapsible = ({ open = false, children, id, ...rest }) => {
    return (
        <Stack
            id={id}
            display={open ? "auto" : "none"}
            {...rest}
        >
            {children}
        </Stack>
    );
};

Collapsible.propTypes = {
    open: PropTypes.bool,
    id: PropTypes.string,
    children: PropTypes.node,
};

export default React.memo(Collapsible);

