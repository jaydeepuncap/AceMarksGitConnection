import React, { memo } from "react";
import { Box, Text } from "../ui";
import AppBridgeModal from "./AppBridgeModal";

const ConfirmationModal = memo(({ onOpen, onClose, title, onConfirm, message, isLoading = false, btnText = 'Delete' }) => {
    return (
        <AppBridgeModal
            open={onOpen}
            onClose={onClose}
            onHide={onClose}
            title={title}
            primaryAction={{ label: btnText, onClick: () => onConfirm(), loading: isLoading, tone: "critical" }}
            secondaryAction={{ label: 'Cancel', onClick: () => onClose() }}
        >
            <Box padding={'base'}>
                {typeof message === 'string' ? <Text>{message}</Text> : message}
            </Box>
        </AppBridgeModal>
    )
});

ConfirmationModal.displayName = 'ConfirmationModal';
export default memo(ConfirmationModal);





