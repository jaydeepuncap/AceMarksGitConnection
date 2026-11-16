import React from "react";
import PropTypes from "prop-types";

const Link = ({
                  children,
                  accessibilityLabel,
                  href,
                  target = "auto",
                  tone = "auto",
                  command = "--auto",
                  commandFor,
                  interestFor,
                  lang,
                  download,
                  onClick,
                  ...rest
              }) => {
    return (
        <s-link
            accessibilityLabel={accessibilityLabel}
            href={href}
            target={target}
            tone={tone}
            command={command}
            commandFor={commandFor}
            interestFor={interestFor}
            lang={lang}
            download={download}
            onClick={onClick}
            {...rest}
        >
            {children}
        </s-link>
    );
};

Link.propTypes = {
    children: PropTypes.node.isRequired,

    // content
    accessibilityLabel: PropTypes.string,
    lang: PropTypes.string,

    // navigation
    href: PropTypes.string,
    target: PropTypes.oneOfType([PropTypes.string]),

    // design
    tone: PropTypes.oneOf(["auto", "critical", "neutral"]),

    // commands
    command: PropTypes.oneOf(["--auto", "--show", "--hide", "--toggle"]),
    commandFor: PropTypes.string,
    interestFor: PropTypes.string,

    // download
    download: PropTypes.string,

    // events
    onClick: PropTypes.func,
};

export default Link;
