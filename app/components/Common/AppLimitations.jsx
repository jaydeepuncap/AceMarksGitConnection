import React, { Fragment } from "react";
import { Banner, Heading, List, Stack } from "../ui";

const AppLimitations = ({ title, type = '' }) => {

    // const limitations = type === 'shipping' ? [
    //     "The Shipping function API doesn't currently support draft orders.",
    //     "Shipping function aren't compatible with Shop Pay.",
    //     "You can't modify local delivery and local pickup options with shipping function.",
    //     "It is only possible to have five Shipping Function methods active at once."
    // ] : type === 'payment' ? [
    //     "The Payment Customization API doesn't currently support draft orders.",
    //     "You can't rename payment methods that have logos.",
    //     "Payment customizations aren't compatible with Shop Pay.",
    //     "The maximum number of payment customization methods you can activate is five.",
    //     "The APP does not hide the express checkout button; you must disable it in Shopify's settings."
    // ] : type === 'discount' ? [
    //     "The Discount function API doesn't currently support draft orders.",
    //     "Discount function aren't compatible with Shop Pay.",
    //     "You can't modify local delivery and local pickup options with discount function.",
    //     "It is only possible to have five Discount Function methods active at once."
    // ] : [];

    const limitations = type === 'shipping' ? [
        // ✅ FIXED (Dec 2024): Draft orders now supported via Shopify Functions
        "Shipping function customizations apply to draft order checkouts, but won't display or apply in the Shopify admin while creating a draft order.",

        // ⚠️ PARTIAL: Still limited for accelerated checkouts; local delivery works with Shop Pay, but shipping customization functions have limited Shop Pay compatibility
        "Shipping functions have limited compatibility with accelerated checkouts (Apple Pay, Google Pay, Amazon Pay, PayPal). Local delivery works with Shop Pay, but other accelerated checkouts are not supported.",

        // ✅ STILL TRUE: Local delivery/pickup can't be modified via Function API
        "You can't modify local delivery and local pickup options with shipping functions.",

        // ❌ CHANGED: Limit increased from 5 → 25
        "You can activate a maximum of 25 Shipping Customization functions on each store.",

    ] : type === 'payment' ? [
        // ✅ FIXED (Dec 2024): Draft orders now supported
        "Payment customizations apply to draft order checkouts, but won't display or apply in the Shopify admin while creating a draft order.",

        // ✅ STILL TRUE
        "You can't rename payment methods that have logos (e.g. Klarna, PayPal).",

        // ⚠️ NUANCED: Payment Customization API can hide accelerated checkouts (Shop Pay, Apple Pay) but only on Shopify Plus via custom app
        "Hiding accelerated checkout buttons (Shop Pay, Apple Pay) via the Payment Customization API requires Shopify Plus and a custom app.",

        // ❌ CHANGED: Limit increased from 5 → 25
        "You can activate a maximum of 25 payment customization functions on each store.",

        // ✅ STILL TRUE
        "The app does not hide the express checkout button; you must disable it in Shopify's settings (unless using a Shopify Plus custom app with the Payment Customization API).",

        // 🆕 NEW: Review requirement limitation
        "A review requirement cannot be applied to orders and draft order invoice checkouts.",

    ] : type === 'discount' ? [
        // ✅ PARTIALLY FIXED: Standard discount functions support draft orders; only functions using network access (fetch target) don't
        "Discount functions with network access (fetch target) aren't supported on draft orders. Standard discount functions do apply to draft order checkouts.",

        // ⚠️ STILL APPLIES for discount functions that modify checkout behavior
        "Discount functions aren't compatible with accelerated checkouts like Shop Pay in certain configurations.",

        // ❌ REMOVED: Discount functions don't control local delivery — this was never a correct limitation for discounts
        // "You can't modify local delivery and local pickup options with discount function." — NOT applicable to discounts

        // ❌ CHANGED: Limit increased from 5 → 25
        "You can activate a maximum of 25 app-generated function-based automatic discounts per store at a time.",

        // 🆕 NEW in 2026-04
        "Discount functions now support tags (added in 2026-04) for better organization and labeling.",

        // 🆕 NEW in 2026-04
        "Discount functions now support prerequisites for Buy X Get Y (BXGY) discounts.",

        // ⚠️ EXISTING
        "The discount function is not re-run when editing an existing order or when recurring subscription orders are created.",

    ] : [];

    return (
        <Fragment>
            <Banner
                heading={title}
                tone="warning"
            >
                <Stack gap="small">
                    <List items={limitations} type="unordered" />
                    <Heading>As soon as Shopify launches the update, we will update our app to match it.</Heading>
                </Stack>
            </Banner>
        </Fragment>
    )
}
export default React.memo(AppLimitations);