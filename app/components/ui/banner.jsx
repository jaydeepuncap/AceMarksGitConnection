import React from 'react';
import PropTypes from 'prop-types';

const Banner = ({
                    children,
                    heading = '',
                    tone = 'auto',
                    dismissible = false,
                    hidden = false,
                    secondaryActions = [],
                    onDismiss,
                    onAfterHide,
                    ...restProps
                }) => {
    const bannerRef = React.useRef(null);

    React.useEffect(() => {
        const banner = bannerRef.current;
        if (!banner) return;

        const handleDismiss = (event) => {
            if (onDismiss) {
                onDismiss(event);
            }
        };

        const handleAfterHide = (event) => {
            if (onAfterHide) {
                onAfterHide(event);
            }
        };

        banner.addEventListener('dismiss', handleDismiss);
        banner.addEventListener('afterhide', handleAfterHide);

        return () => {
            banner.removeEventListener('dismiss', handleDismiss);
            banner.removeEventListener('afterhide', handleAfterHide);
        };
    }, [onDismiss, onAfterHide]);

    return (
        <s-banner
            ref={bannerRef}
            heading={heading}
            tone={tone}
            dismissible={dismissible}
            hidden={hidden}
            {...restProps}
        >
            {children}
            {secondaryActions.length > 0 && secondaryActions.map((action, i) => (
                <s-button
                    key={action.key || `secondary-action-${i}`}
                    slot="secondary-actions"
                    variant={action.variant || 'secondary'}
                    onClick={action.onClick}
                    disabled={action.disabled}
                >
                    {action.label}
                </s-button>
            ))}
        </s-banner>
    );
};

Banner.propTypes = {
    children: PropTypes.node.isRequired,
    heading: PropTypes.string,
    tone: PropTypes.oneOf(['info', 'success', 'warning', 'critical', 'auto']),
    dismissible: PropTypes.bool,
    hidden: PropTypes.bool,
    secondaryActions: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string.isRequired,
            onClick: PropTypes.func.isRequired,
            variant: PropTypes.oneOf(['secondary', 'auto']),
            disabled: PropTypes.bool,
            key: PropTypes.string,
        })
    ),
    onDismiss: PropTypes.func,
    onAfterHide: PropTypes.func,
};

export default Banner;
