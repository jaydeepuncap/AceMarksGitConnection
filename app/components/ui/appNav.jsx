import React from 'react';
import PropTypes from 'prop-types';

const AppNav = ({
                    menus,
                    ...otherProps
                }) => {
    return (
        <s-app-nav {...otherProps}>
            {menus.map((x, i) => {
                return (
                    <s-link href={x.destination} key={`nav-link-${i}`} rel={i === 0 ? "home": ""}>{x.label}</s-link>
                )
            })}
        </s-app-nav>
    );
};

AppNav.propTypes = {
    menus: PropTypes.node.isRequired,
};

export default AppNav;

//Use Link component
// <AppNav>
//     <s-link href="/" rel="home">Home</s-link>
//     <s-link href="/templates">Templates</s-link>
//     <s-link href="/settings">Settings</s-link>
// </AppNav>