import React from "react";

import PropTypes from "prop-types";
import { Button, Section } from "./";

const Menu = ({
    id,
    accessibilityLabel,
    trigger,
    items = [],
    sections = [],
    ...rest
}) => {
    return (
        <>
            {/* Trigger Button */}
            <Button
                {...trigger}
                commandFor={id}
            >
                {trigger.label}
            </Button>

            {/* Menu */}
            <s-menu
                id={id}
                accessibilityLabel={accessibilityLabel}
                {...rest}
            >
                {/* SECTION ITEMS */}
                {sections.map((section, i) => (
                    <Section key={i} heading={section.heading} accessibilityLabel={section.heading}>
                        {section.items.map((item, j) => (
                            <Button key={j} {...item}>
                                {item.label}
                            </Button>
                        ))}
                    </Section>
                ))}

                {/* NORMAL ITEMS */}
                {items.map((item, i) => (
                    <Button key={i} {...item}>
                        {item.label}
                    </Button>
                ))}
            </s-menu>
        </>
    );
};

Menu.propTypes = {
    id: PropTypes.string.isRequired,
    accessibilityLabel: PropTypes.string,

    trigger: PropTypes.shape({
        label: PropTypes.node.isRequired,
        icon: PropTypes.string,
        variant: PropTypes.string,
        tone: PropTypes.string,
    }).isRequired,

    // Non-section items
    items: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.node.isRequired,
            icon: PropTypes.string,
            tone: PropTypes.string,
            href: PropTypes.string,
            download: PropTypes.string,
            disabled: PropTypes.bool,
        })
    ),

    // Sectioned items
    sections: PropTypes.arrayOf(
        PropTypes.shape({
            heading: PropTypes.string.isRequired,
            items: PropTypes.arrayOf(
                PropTypes.shape({
                    label: PropTypes.node.isRequired,
                    icon: PropTypes.string,
                    tone: PropTypes.string,
                    href: PropTypes.string,
                    download: PropTypes.string,
                    disabled: PropTypes.bool,
                })
            ),
        })
    ),
};

export default Menu;


/*<Menu
    id="admin-settings"
    accessibilityLabel="Settings menu"
    trigger={{ label: "Settings", icon: "settings" }}
    sections={[
        {
            heading: "Account",
            items: [
                { label: "Profile settings", icon: "profile", onClick: () => {console.log("Create puzzle")} },
                { label: "Security", icon: "lock" },
                { label: "Billing information" },
            ],
        },
        {
            heading: "Store",
            items: [
                { label: "Store settings", icon: "store" },
                { label: "Payment providers" },
                { label: "Shipping rates", icon: "delivery",onClick: () => {console.log("Create puzzle")} },
            ],
        },
    ]}
    items={[
        { label: "Sign out", icon: "person-exit", href: "javascript:void(0)" },
        { label: "Sign out", icon: "person-exit", onClick: () => {console.log("Create puzzle")} },
    ]}
/>*/
