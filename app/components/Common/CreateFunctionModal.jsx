import React, { Fragment } from 'react'
import { Box, Button, Heading, Icon, Link, Stack, Text, Grid, GridItem } from '../ui'
import AppBridgeModal from './AppBridgeModal';
import { appRoutes } from '../../routes/appRoutes';
import { useNavigate } from 'react-router-dom';
import { toggleChat } from '../../utils/Constent';

const CreateFunctionModal = ({ open, onClose, title, type }) => {
    const navigate = useNavigate();

    const routeManagement = (ruleType, method) => {
        switch (ruleType) {
            case "shipping":
                return appRoutes?.shippingMethod('new', method);
            case "payment":
                return appRoutes?.paymentMethod('new', method);
            default:
                return null;
        }
    };

    const shippingPaymentCards = [
        {
            label: 'Rename',
            icon: 'edit',
            desc: type === 'shipping'
                ? 'Edit the display name of a shipping method to make it clearer for customers.'
                : 'Edit the display name of a payment gateway to make it clearer for customers.',
            onClick: () => { onClose(); navigate(routeManagement(type, '1')); },
        },
        {
            label: 'Reorder',
            icon: 'sort',
            desc: type === 'shipping'
                ? 'Change the display order of shipping methods to highlight your preferred option.'
                : 'Change the display order of payment gateways to highlight your preferred option.',
            onClick: () => { onClose(); navigate(routeManagement(type, '2')); },
        },
        {
            label: 'Hide',
            icon: 'eye',
            desc: type === 'shipping'
                ? 'Hide specific shipping methods when certain conditions are met.'
                : 'Hide specific payment gateways when certain conditions are met.',
            onClick: () => { onClose(); navigate(routeManagement(type, '3')); },
        },
    ];

    const discountCards = [
        {
            label: 'Product Discount',
            icon: 'product',
            desc: "Apply discounts to a specific product or variant in the cart.",
            onClick: () => { onClose(); navigate(appRoutes?.productDiscount('new')); },
        },
        {
            label: 'Shipping Discount',
            icon: 'truck',
            desc: "Apply discounts to multiple shipping rates at checkout.",
            onClick: () => { onClose(); navigate(appRoutes?.shippingDiscount('new')); },
        },
        {
            label: 'Order Discount',
            icon: 'discount',
            desc: "Apply discounts to entire orders based on your custom rules.",
            onClick: () => { onClose(); navigate(appRoutes?.orderDiscount('new')); },
        },
    ];

    const cards = type === 'discount' ? discountCards : shippingPaymentCards;

    return (
        <Fragment>
            <AppBridgeModal
                id="create-shopify-function-modal"
                open={open}
                onClose={onClose}
                onHide={onClose}
                title={title}
                secondaryAction={{ label: 'Cancel', onClick: onClose }}
            >
                <Grid
                    gridTemplateColumns="repeat(3, 1fr)"
                    gap="base"
                    padding="base"
                >
                    {cards.map(({ label, icon, desc, onClick }) => (
                        <GridItem
                            key={label}
                            border="base"
                            borderColor="base"
                            borderStyle="solid"
                            borderWidth="small"
                            borderRadius="base"
                            background="base"
                        >
                            <Stack gap="small-400" padding="base" blockSize="100%">
                                <Stack gap="small-400">
                                    <Stack
                                        background="subdued"
                                        padding="small-400"
                                        borderRadius="base"
                                        alignItems="center"
                                        justifyContent="center"
                                        inlineSize="auto"
                                    >
                                        <Icon type={icon} />
                                    </Stack>
                                    <Stack gap="100">
                                        <Heading level="h4">{label}</Heading>
                                        <Text color="subdued">{desc}</Text>
                                    </Stack>
                                </Stack>
                                <Button variant="secondary" onClick={onClick}>Create</Button>
                            </Stack>
                        </GridItem>
                    ))}
                </Grid>
                <Box padding="base">
                    Need help? <Link onClick={() => toggleChat()}>Contact Us</Link>
                </Box>
            </AppBridgeModal>
        </Fragment>
    );
};

export default React.memo(CreateFunctionModal);