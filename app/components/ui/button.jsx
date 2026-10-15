import React from "react";
import PropTypes from "prop-types";

const Button = ({
                    children,
                    accessibilityLabel,
                    variant = "auto",
                    tone = "auto",
                    type = "button",
                    icon = "",
                    href,
                    target = "auto",
                    disabled = false,
                    loading = false,
                    command = "--auto",
                    commandFor,
                    interestFor,
                    download,
                    onClick,
                    onFocus,
                    onBlur,
                    slot="",
                    inlineSize = "auto",
                    fullWidth = false,
                    ...rest
                }) => {
    return (
        <s-button
            accessibilityLabel={accessibilityLabel}
            variant={variant}
            tone={tone}
            type={type}
            icon={icon}
            href={href}
            target={target}
            disabled={disabled}
            loading={loading}
            command={command}
            commandFor={commandFor}
            interestFor={interestFor}
            download={download}
            onClick={onClick}
            onFocus={onFocus}
            onBlur={onBlur}
            slot={slot}
            inlineSize={fullWidth ? "fill" : inlineSize}
            {...rest}
        >
            {children}
        </s-button>
    );
};

Button.propTypes = {
    children: PropTypes.node,
    accessibilityLabel: PropTypes.string,

    // visuals & design
    variant: PropTypes.oneOf(["auto", "primary", "secondary", "tertiary"]),
    tone: PropTypes.oneOf(["auto", "critical", "neutral"]),
    icon: PropTypes.oneOf([
        "",
        "replace",
        "search",
        "split",
        "link",
        "edit",
        "product",
        "variant",
        "collection",
        "select",
        "info",
        "complete",
        "incomplete",
        "color",
        "money",
        "adjust",
        "affiliate",
        "airplane",
        "alert-circle",
        "alert-triangle",
        "apps",
        "archive",
        "arrow-down",
        "arrow-left",
        "arrow-right",
        "arrow-up",
        "bag",
        "bank",
        "barcode",
        "bill",
        "blog",
        "bolt",
        "book",
        "bookmark",
        "bug",
        "calendar",
        "camera",
        "cart",
        "cash-dollar",
        "categories",
        "chart-line",
        "chat",
        "check",
        "chevron-down",
        "chevron-right",
        "circle",
        "clipboard",
        "clock",
        "code",
        "collection-list",
        "credit-card",
        "crop",
        "database",
        "delete",
        "desktop",
        "discount",
        "domain",
        "download",
        "edit",
        "email",
        "empty",
        "exit",
        "export",
        "external",
        "eye",
        "eye-dropper",
        "file",
        "filter",
        "flag",
        "folder",
        "gift",
        "globe",
        "grid",
        "heart",
        "home",
        "image",
        "import",
        "inventory",
        "key",
        "language",
        "link",
        "list-bulleted",
        "live",
        "location",
        "lock",
        "map",
        "markets",
        "maximize",
        "menu",
        "merge",
        "microphone",
        "minus",
        "mobile",
        "moon",
        "note",
        "notification",
        "order",
        "package",
        "page",
        "paint-brush-round",
        "paper-check",
        "payment",
        "payout",
        "person",
        "phone",
        "pin",
        "plan",
        "play",
        "plus",
        "print",
        "product-add",
        "profile",
        "question-circle",
        "receipt",
        "redo",
        "refresh",
        "remove-background",
        "reset",
        "return",
        "reward",
        "rocket",
        "save",
        "scan-qr-code",
        "search-list",
        "send",
        "settings",
        "share",
        "shield",
        "slideshow",
        "smiley-happy",
        "sort",
        "sound",
        "star",
        "status",
        "stop-circle",
        "store",
        "sun",
        "table",
        "target",
        "text",
        "theme",
        "thumbs-up",
        "transaction",
        "transfer",
        "truck",
        "undo",
        "upload",
        "variant-list",
        "video",
        "view",
        "wallet",
        "wand",
        "watch",
        "wifi",
        "work",
        "wrench",
        "x",
        "x-circle",
    ]),

    // behavior
    type: PropTypes.oneOf(["button", "reset", "submit"]),
    slot: PropTypes.oneOf(["", "primary-action", "secondary-actions"]),
    disabled: PropTypes.bool,
    loading: PropTypes.bool,

    // navigation
    href: PropTypes.string,
    target: PropTypes.oneOfType([PropTypes.string]),

    // commands
    command: PropTypes.oneOf(["--auto", "--show", "--hide", "--toggle"]),
    commandFor: PropTypes.string,
    interestFor: PropTypes.string,
    download: PropTypes.string,

    // events
    onClick: PropTypes.func,
    onBlur: PropTypes.func,
    onFocus: PropTypes.func,
};

export default Button;
