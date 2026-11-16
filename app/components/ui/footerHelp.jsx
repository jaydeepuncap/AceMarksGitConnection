import React from "react";
import PropTypes from "prop-types";

const FooterHelp = ({ children }) => {
    return (
        <s-box paddingBlockStart="base" paddingBlockEnd="small">
            <s-stack alignItems="center" justifyContent="center">
                {children ? children : (
                    <s-text>
                        if you need any help, please{' '}
                        <a href="mailto:support@uncap.com" target="_blank">Contact us</a>
                    </s-text>
                )}
            </s-stack>
        </s-box>
    );
};

FooterHelp.propTypes = {
    children: PropTypes.node,
};

export default FooterHelp;
