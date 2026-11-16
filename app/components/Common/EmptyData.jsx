import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Grid, Heading, Image, Stack } from '../ui';

const EmptyData = memo(({ title = "No data found", children = '' }) => {
    return (
        <Stack gap={"small-300"} background='base'>
            <Grid gap="base" justifyContent="center" paddingBlock="large-400" alignContent='center' alignItems='center'>
                <Stack alignContent='center' alignItems='center'>
                    <Image
                        aspectRatio="1/0.2"
                        src="https://cdn-icons-png.freepik.com/256/15145/15145145.png?semt=ais_white_label"
                        alt="A stylized graphic of four characters, each holding a puzzle piece"
                    />
                </Stack>
                <Grid justifyItems="center" maxInlineSize="450px" gap="base" alignContent='center' alignItems='center'>
                    <Stack alignItems="center" gap="small" justifyContent='center' alignContent='center'>
                        <Heading>{title}</Heading>
                        {children && children}
                    </Stack>
                </Grid>
            </Grid>
        </Stack>
    )
});

EmptyData.propTypes = {
    title: PropTypes.string,
    children: PropTypes.node,
    image: PropTypes.string,
};

EmptyData.displayName = "EmptyData";

export default React.memo(EmptyData);