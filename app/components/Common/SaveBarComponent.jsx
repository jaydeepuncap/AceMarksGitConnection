import React, { useId } from 'react';

import { SaveBar } from "@shopify/app-bridge-react";

const SaveBarComponent = ({ isDirty, onDiscard, onSave, loading, disabled, id }) => {
    const componentId = useId()

    return (
        <SaveBar key={id || componentId} id={id || componentId} open={isDirty} discardConfirmation=''>
            <button variant="primary" disabled={disabled} onClick={onSave} loading={loading ? "" : null} />
            <button onClick={loading ? null : onDiscard} />
        </SaveBar>
    );
};

export default React.memo(SaveBarComponent);