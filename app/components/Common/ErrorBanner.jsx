import React, { Fragment, memo, useId } from 'react';

import PropTypes from 'prop-types';
import { Banner, Box } from "../ui";
import { capitalizeMessage } from '../../utils/Constent';

const ErrorBanner = memo(({ message = "", setMessage = () => { }, link = "", ...rest }) => {
    const ID = useId();

    const onDismissBanner = () => {
        setMessage("")
    };

    if (message.trim() === "") {
        return null;
    };

    return (
        <Fragment>
            <Box {...rest} paddingBlockEnd='base'>
                <Banner
                    key={`${ID}-error-banner`}
                    id={`${ID}-error-banner`}
                    heading="Error"
                    tone={'critical'}
                    dismissible
                    onDismiss={() => onDismissBanner()}
                    secondaryActions={
                        link && link.trim() !== "" ? [
                            { label: 'Get support', onClick: () => window.open(link, "_blank"), variant: 'secondary' }
                        ] : []}
                >
                    <span dangerouslySetInnerHTML={{ __html: capitalizeMessage(message) }} />
                </Banner>
            </Box>
        </Fragment>
    );
});

ErrorBanner.propTypes = {
    message: PropTypes.string,
    setMessage: PropTypes.func,
    link: PropTypes.string,
}

export default memo(ErrorBanner);