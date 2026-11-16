import React, { Fragment, useEffect, useId } from 'react';
import { Modal, TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import PropTypes from 'prop-types';

const AppBridgeModal = ({ id, open, onClose = () => { }, onHide = () => { }, title = '', primaryAction = null, secondaryAction = null, children, variant = 'base', ...props }) => {
    const shopify = useAppBridge();
    const generatedId = useId();
    const modalId = id ?? generatedId;

    useEffect(() => {
        if (open) {
            shopify.modal.show(modalId);
        } else {
            shopify.modal.hide(modalId);
        }
    }, [open, modalId]);

    const handleClose = () => {
        onClose();
        shopify.modal.hide(modalId);
    };

    const handleHide = () => {
        onHide();
        shopify.modal.hide(modalId);
    };

    return (
        <Modal id={`${modalId}`} open={open} onClose={() => handleClose()} onHide={() => handleHide()} {...props} variant={variant}>

            <TitleBar title={title}>
                {primaryAction && primaryAction.label && (
                    <button
                        variant="primary" tone={primaryAction.tone || "default"}
                        onClick={() => primaryAction.onClick()}
                        loading={primaryAction.loading ? "" : null}
                        disabled={primaryAction.disabled}
                    >
                        {primaryAction.label}
                    </button>
                )}
                {secondaryAction && secondaryAction.label && secondaryAction.onClick && (
                    <button
                        onClick={() => secondaryAction.onClick()}
                        loading={secondaryAction.loading ? "" : null}
                        disabled={secondaryAction.disabled}
                    >
                        {secondaryAction.label}
                    </button>
                )}
            </TitleBar>

            <Fragment>
                {children}
            </Fragment>
        </Modal>
    )
}

AppBridgeModal.propTypes = {
    open: PropTypes.bool,
    onClose: PropTypes.func,
    onHide: PropTypes.func,
    title: PropTypes.string,
    primaryAction: PropTypes.shape({
        label: PropTypes.string,
        onClick: PropTypes.func,
        disabled: PropTypes.bool,
        loading: PropTypes.bool,
    }),
    secondaryAction: PropTypes.shape({
        label: PropTypes.string,
        onClick: PropTypes.func,
        disabled: PropTypes.bool,
        loading: PropTypes.bool,
    }),
    children: PropTypes.node,
    variant: PropTypes.oneOf(['base', 'small', 'large']),
};

export default React.memo(AppBridgeModal);