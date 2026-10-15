import React, { useEffect, useRef } from 'react';

import PropTypes from 'prop-types';
import FooterHelp from './footerHelp';

const Page = ({
    heading,
    inlineSize = 'base',
    aside,
    primaryAction,
    secondaryAction = [],
    breadcrumbAction,
    children,
    ...restProps
}) => {
    const primaryRef = useRef(null);
    const secondaryRefs = useRef({});
    const breadcrumbRef = useRef(null);

    /**
     * Normalize secondary actions so every action has a stable key
     */
    const normalizedSecondaryActions = secondaryAction?.map((action, index) => ({
        ...action,
        key: action.key ?? `secondary-action-${index}`,
    }));

    useEffect(() => {
        // ---- Primary action ----
        if (primaryRef.current && primaryAction?.onClick) {
            primaryRef.current.addEventListener('click', primaryAction.onClick);
        }

        // ---- Secondary actions ----
        normalizedSecondaryActions?.forEach(action => {
            const el = secondaryRefs.current[action.key];
            if (el && action.onClick) {
                el.addEventListener('click', action.onClick);
            }
        });

        // ---- Breadcrumb action ----
        if (breadcrumbRef.current && breadcrumbAction?.onClick) {
            breadcrumbRef.current.addEventListener('click', breadcrumbAction.onClick);
        }

        return () => {
            // Cleanup primary
            if (primaryRef.current && primaryAction?.onClick) {
                primaryRef.current.removeEventListener('click', primaryAction.onClick);
            }

            // Cleanup secondary
            normalizedSecondaryActions?.forEach(action => {
                const el = secondaryRefs.current[action.key];
                if (el && action.onClick) {
                    el.removeEventListener('click', action.onClick);
                }
            });

            // Cleanup breadcrumb
            if (breadcrumbRef.current && breadcrumbAction?.onClick) {
                breadcrumbRef.current.removeEventListener('click', breadcrumbAction.onClick);
            }
        };
    }, [primaryAction, normalizedSecondaryActions, breadcrumbAction]);

    return (
        <s-page
            heading={heading}
            inlineSize={inlineSize}
            aside={aside}
            {...restProps}
        >
            {/* Breadcrumb */}
            {breadcrumbAction?.label && (
                <s-link
                    ref={breadcrumbRef}
                    slot="breadcrumb-actions"
                    href={breadcrumbAction.href || '#'}
                >
                    {breadcrumbAction.label}
                </s-link>
            )}

            {/* Secondary actions */}
            {(normalizedSecondaryActions && normalizedSecondaryActions?.length > 0) ? normalizedSecondaryActions?.map(action => (
                <s-button
                    key={action.key}
                    ref={el => {
                        if (el) secondaryRefs.current[action.key] = el;
                    }}
                    slot="secondary-actions"
                    variant={action.variant || 'secondary'}
                    tone={action.tone || 'default'}
                    icon={action.icon || undefined}
                    disabled={action.disabled}
                >
                    {action.label}
                </s-button>
            )) : null}

            {/* Primary action */}
            {primaryAction && (
                <s-button
                    ref={primaryRef}
                    slot="primary-action"
                    variant={primaryAction.variant || 'primary'}
                    icon={primaryAction.icon || undefined}
                    disabled={primaryAction.disabled}
                    loading={primaryAction.loading || false}
                >
                    {primaryAction.label}
                </s-button>
            )}

            <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 57px)" }}>
                <div style={{ flex: 1 }}>
                    {children}
                </div>
                <FooterHelp />
            </div>
        </s-page>
    );
};

Page.propTypes = {
    heading: PropTypes.string,
    inlineSize: PropTypes.oneOf(['base', 'small', 'large']),
    aside: PropTypes.string,

    primaryAction: PropTypes.shape({
        label: PropTypes.string,
        onClick: PropTypes.func,
        disabled: PropTypes.bool,
        variant: PropTypes.string,
        loading: PropTypes.bool,
    }),

    secondaryAction: PropTypes.arrayOf(
        PropTypes.shape({
            key: PropTypes.string,
            label: PropTypes.string,
            onClick: PropTypes.func,
            disabled: PropTypes.bool,
            variant: PropTypes.string,
        })
    ),

    breadcrumbAction: PropTypes.shape({
        label: PropTypes.string,
        onClick: PropTypes.func,
    }),

    children: PropTypes.node,
};

export default Page;
