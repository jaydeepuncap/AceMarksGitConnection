import React from "react";
import PropTypes from "prop-types";

const List = ({ type = "unordered", items = [], ...rest }) => {
    const Tag = type === "ordered" ? "s-ordered-list" : "s-unordered-list";

    return (
        <Tag {...rest}>
            {items.map((item, index) => (
                <s-list-item key={index}>{item}</s-list-item>
            ))}
        </Tag>
    );
};

List.propTypes = {
    type: PropTypes.oneOf(["unordered", "ordered"]),
    items: PropTypes.arrayOf(PropTypes.node).isRequired,
};

export default List;
