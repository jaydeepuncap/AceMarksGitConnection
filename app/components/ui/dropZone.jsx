import React from "react";
import PropTypes from "prop-types";

const DropZone = ({
                      label,
                      accessibilityLabel,
                      accept,
                      disabled,
                      error,
                      files,
                      labelAccessibilityVisibility = "visible",
                      multiple,
                      name,
                      required,
                      value,

                      // Events
                      onChange,
                      onInput,
                      onDropRejected,

                      children,
                      ...rest
                  }) => {
    return (
        <s-drop-zone
            label={label}
            accessibilityLabel={accessibilityLabel}
            accept={accept}
            disabled={disabled}
            error={error}
            files={files}
            labelAccessibilityVisibility={labelAccessibilityVisibility}
            multiple={multiple}
            name={name}
            required={required}
            value={value}
            onChange={onChange}
            onInput={onInput}
            onDroprejected={onDropRejected}
            {...rest}
        >
            {children}
        </s-drop-zone>
    );
};

DropZone.propTypes = {
    /** Label + accessibility */
    label: PropTypes.string,
    accessibilityLabel: PropTypes.string,
    labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

    /** Upload behavior */
    accept: PropTypes.string,
    multiple: PropTypes.bool,
    required: PropTypes.bool,
    disabled: PropTypes.bool,
    name: PropTypes.string,

    /** Value + files */
    value: PropTypes.string,
    files: PropTypes.arrayOf(PropTypes.instanceOf(File)),
    error: PropTypes.string,

    /** Children inside slot */
    children: PropTypes.node,

    /** Events */
    onChange: PropTypes.func,
    onInput: PropTypes.func,
    onDropRejected: PropTypes.func,
};

export default DropZone;

//<DropZone
//   label="Upload product images"
//   accept="image/*"
//   multiple
// >
//   <div style={{ textAlign: "center", padding: "20px" }}>
//     <strong>Drop files here</strong><br />
//     or click to upload
//   </div>
// </DropZone>
