import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

/**
 * Wrapper around <s-modal>. Two usage modes:
 *
 *   Declarative (preferred): drive visibility via the `open` prop, the
 *   wrapper calls .showOverlay() / .hideOverlay() in sync.
 *
 *   Imperative (legacy): omit `open`; toggle by calling .showOverlay() /
 *   .hideOverlay() on a ref or by passing `id` to a button's `commandFor`.
 *
 * `onHide` always fires when the modal is dismissed (backdrop click, Esc,
 * or programmatic hide). When using `open`, wire `onHide` → `setOpen(false)`
 * so DOM state and React state never drift.
 */
const Modal = ({
                   children,
                   id,
                   open,
                   heading,
                   accessibilityLabel,
                   size = 'base',
                   padding = 'base',
                   onShow,
                   onHide,
                   onAfterShow,
                   onAfterHide,
                   primaryAction,
                   secondaryActions,
                   ...otherProps
               }) => {
    const ref = useRef(null);

    // Custom elements ignore React's synthetic event delegation, so attach
    // the lifecycle listeners imperatively. Without this, closing the modal
    // by clicking the backdrop never reaches the parent's onHide handler
    // and the parent's `open` state stays out of sync with the DOM.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const handlers = [
            ['show', onShow],
            ['hide', onHide],
            ['aftershow', onAfterShow],
            ['afterhide', onAfterHide],
        ];
        for (const [name, fn] of handlers) {
            if (fn) el.addEventListener(name, fn);
        }
        return () => {
            for (const [name, fn] of handlers) {
                if (fn) el.removeEventListener(name, fn);
            }
        };
    }, [onShow, onHide, onAfterShow, onAfterHide]);

    // Declarative `open` sync. We only run when `open` is a defined boolean,
    // so the legacy imperative pattern (no `open` prop) is left untouched.
    useEffect(() => {
        if (open === undefined) return;
        const el = ref.current;
        if (!el) return;
        if (open) el.showOverlay?.();
        else el.hideOverlay?.();
    }, [open]);

    return (
        <s-modal
            ref={ref}
            id={id}
            heading={heading}
            accessibilityLabel={accessibilityLabel}
            size={size}
            padding={padding}
            {...otherProps}
        >
            {children}
            {primaryAction && (
                {...primaryAction}
            )}
            {secondaryActions && (
              {...secondaryActions}
            )}
        </s-modal>
    );
};

Modal.propTypes = {
    children: PropTypes.node,
    id: PropTypes.string,
    open: PropTypes.bool,
    heading: PropTypes.string,
    accessibilityLabel: PropTypes.string,
    size: PropTypes.oneOf(['small', 'small-100', 'base', 'large', 'large-100']),
    padding: PropTypes.oneOf(['base', 'none']),
    onShow: PropTypes.func,
    onHide: PropTypes.func,
    onAfterShow: PropTypes.func,
    onAfterHide: PropTypes.func,
    primaryAction: PropTypes.node,
    secondaryActions: PropTypes.node,
};

export default Modal;
