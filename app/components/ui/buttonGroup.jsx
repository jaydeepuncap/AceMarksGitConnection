import React from "react";
import PropTypes from "prop-types";
import Button from "./button";

const ButtonGroup = ({
    accessibilityLabel,
    gap = "base",
    primaryAction,
    secondaryActions = [],
    ...rest
}) => {
    return (
        <s-button-group
            accessibilityLabel={accessibilityLabel}
            gap={gap}
            {...rest}
        >
            {/* PRIMARY ACTION */}
            {primaryAction && (
                <Button
                    {...primaryAction}
                    variant={primaryAction.variant || "primary"}
                    slot="primary-action"
                >
                    {primaryAction.label}
                </Button>
            )}

            {/* SECONDARY ACTIONS */}
            {secondaryActions.map((action, index) => {
                return (
                    <Button
                        key={index}
                        {...action}
                        variant={action.pressed ? "primary" : action.variant || "secondary"}
                        slot="secondary-actions"
                    >
                        {action.label}
                    </Button>
                )
            })}
        </s-button-group>
    );
};

ButtonGroup.propTypes = {
    accessibilityLabel: PropTypes.string,
    gap: PropTypes.oneOf(["base", "none"]),

    primaryAction: PropTypes.shape({
        label: PropTypes.node || PropTypes.string,
        onClick: PropTypes.func,
        variant: PropTypes.oneOf(["primary"]),
        icon: PropTypes.string,
        disabled: PropTypes.bool,
        loading: PropTypes.bool,
    }),

    secondaryActions: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.node || PropTypes.string,
            onClick: PropTypes.func,
            variant: PropTypes.oneOf(["secondary", "auto"]),
            icon: PropTypes.string,
            disabled: PropTypes.bool,
            loading: PropTypes.bool,
        })
    ),
};

export default ButtonGroup;


// <ButtonGroup
//     accessibilityLabel="Save or cancel changes"
//     primaryAction={{ label: "Save", onClick: saveHandler }}
//     secondaryActions={[
//         { label: "Cancel", onClick: cancelHandler }
//     ]}
// />
