import React from "react";
import PropTypes from "prop-types";

const Box = ({
                  children,
                  accessibilityLabel = "",
                  accessibilityRole = "generic",
                  accessibilityVisibility = "visible",
                  background = "transparent",
                  blockSize = "auto",
                  border = "none",
                  borderColor = "",
                  borderRadius = "none",
                  borderStyle = "",
                  borderWidth = "",
                  display = "auto",
                  inlineSize = "auto",
                  maxBlockSize = "none",
                  maxInlineSize = "none",
                  minBlockSize = "0",
                  minInlineSize = "0",
                  overflow = "visible",
                  padding = "none",
                  paddingBlock = "",
                  paddingBlockEnd = "",
                  paddingBlockStart = "",
                  paddingInline = "",
                  paddingInlineEnd = "",
                  paddingInlineStart = "",
                  ...rest
              }) => {
    return (
        <s-box
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            accessibilityVisibility={accessibilityVisibility}
            background={background}
            blockSize={blockSize}
            border={border}
            borderColor={borderColor}
            borderRadius={borderRadius}
            borderStyle={borderStyle}
            borderWidth={borderWidth}
            display={display}
            inlineSize={inlineSize}
            maxBlockSize={maxBlockSize}
            maxInlineSize={maxInlineSize}
            minBlockSize={minBlockSize}
            minInlineSize={minInlineSize}
            overflow={overflow}
            padding={padding}
            paddingBlock={paddingBlock}
            paddingBlockEnd={paddingBlockEnd}
            paddingBlockStart={paddingBlockStart}
            paddingInline={paddingInline}
            paddingInlineEnd={paddingInlineEnd}
            paddingInlineStart={paddingInlineStart}
            {...rest}
        >
            {children}
        </s-box>
    );
};

Box.propTypes = {
    children: PropTypes.node,
    accessibilityLabel: PropTypes.string,
    accessibilityRole: PropTypes.oneOf([
        "main",
        "header",
        "footer",
        "section",
        "aside",
        "navigation",
        "ordered-list",
        "list-item",
        "list-item-separator",
        "unordered-list",
        "separator",
        "status",
        "alert",
        "generic",
        "presentation",
        "none",
    ]),
    accessibilityVisibility: PropTypes.oneOf(["visible", "hidden", "exclusive"]),
    background: PropTypes.oneOf(["transparent", "subdued", "base", "strong"]),
    blockSize: PropTypes.string,
    border: PropTypes.oneOf(['none', 'base', 'auto']),
    borderColor: PropTypes.oneOf(["", "subdued", "base", "strong"]),
    borderRadius: PropTypes.oneOf([
        "small",
        "small-200",
        "small-100",
        "base",
        "large",
        "large-100",
        "large-200",
        "none",
    ]),
    borderStyle: PropTypes.oneOf(["", "auto", "none", "solid", "dashed"]),
    borderWidth: PropTypes.string,
    display: PropTypes.oneOf(["auto", "none"]),
    inlineSize: PropTypes.string,
    maxBlockSize: PropTypes.string,
    maxInlineSize: PropTypes.string,
    minBlockSize: PropTypes.string,
    minInlineSize: PropTypes.string,
    overflow: PropTypes.oneOf(["visible", "hidden"]),
    padding: PropTypes.string,
    paddingBlock: PropTypes.string,
    paddingBlockEnd: PropTypes.string,
    paddingBlockStart: PropTypes.string,
    paddingInline: PropTypes.string,
    paddingInlineEnd: PropTypes.string,
    paddingInlineStart: PropTypes.string,
};

export default Box;
