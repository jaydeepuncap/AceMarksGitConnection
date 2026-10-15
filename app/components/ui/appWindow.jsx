import React from 'react';
import PropTypes from 'prop-types';

const AppWindow = ({
                       id,
                       src,
                       // Event handlers
                       onShow,
                       onHide,
                       ...otherProps
                   }) => {
    return (
        <s-app-window
            id={id}
            src={src}
            onShow={onShow}
            onHide={onHide}
            {...otherProps}
        />
    );
};

AppWindow.propTypes = {
    id: PropTypes.string,
    src: PropTypes.string.isRequired,
    // Event handlers
    onShow: PropTypes.func,
    onHide: PropTypes.func,
};

export default AppWindow;


// Basic app window with button trigger:
//     <>
//     <AppWindow id="app-window" src="/app-window-content.html" />
//     <Button command="--show" commandFor="app-window">
//     Open App Window
// </Button>
// </>
// With event handlers:
//     <AppWindow
// id="app-window"
// src="/app-window-content.html"
// onShow={() => console.log('App window opened')}
// onHide={() => console.log('App window closed')}
// />
// Multiple control buttons:
//
//     <AppWindow id="app-window" src="/app-window-content.html" />
//     <Button command="--show" commandFor="app-window">Open</Button>
// <Button command="--hide" commandFor="app-window">Close</Button>
// <Button command="--toggle" commandFor="app-window">Toggle</Button>
// </>
// Programmatic control:
//
//     <AppWindow id="app-window" src="/app-window-content.html" />
//     <Button onClick={() => document.getElementById('app-window').show()}>
// Show App Window
// </Button>
// <Button onClick={() => document.getElementById('app-window').hide()}>
//     Hide App Window
// </Button>
// </>
// App Window Content (app-window-content.html):
// Simple page:
//     html<s-page heading="App Window Title"></s-page>
// Page with actions:
// <s-page heading="App Window Title">
//     <s-button slot="primary-action" onclick="shopify.toast.show('Save')">
//     Save
//     </s-button>
// <s-button slot="secondary-actions" onclick="shopify.toast.show('Close')">
//     Close
// </s-button>
// </s-page>