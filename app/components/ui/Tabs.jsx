import React, { Fragment, memo, useId, useState, useEffect } from 'react';

import PropTypes from "prop-types";
import { Box, Grid, GridItem, QueryContainer, Stack } from './';

const TabButton = memo(({ tab, index, isSelected, onClick, variant, fullWidth, inlineSize }) => (
    <s-press-button
        data-tab-index={index}
        data-tab-id={tab.id}
        pressed={isSelected ? true : false}
        onClick={isSelected ? null : onClick}
        variant={variant}
        disabled={tab.disabled}
        icon={tab.icon}
        inlineSize={fullWidth ? "fill" : inlineSize}
    >
        {tab.content || tab.label}
    </s-press-button>
));

TabButton.displayName = 'TabButton';

const Tabs = ({
    tabs = [],
    selected = 0,
    onSelect,
    variant = "tertiary",
    gap = "small-300",
    containerName = '',
    boxBackground = 'transparent',
    boxBorder = 'base',
    boxBorderRadius = 'base',
    boxPadding = 'small-300',
    fullWidth = false,
    inlineSize = "auto",
    ...rest
}) => {

    const generatedId = useId();
    const containerNameId = containerName ?? generatedId;
    const [selectedTab, setSelectedTab] = useState(selected);

    useEffect(() => {
        setSelectedTab(selected);
    }, [selected]);

    const handleTabClick = (id) => {
        setSelectedTab(id);
        if (onSelect) {
            onSelect(id);
        }
    };

    return (
        <QueryContainer containerName={containerNameId}>
            <Box
                // paddingBlockEnd={`@container ${containerNameId} (inline-size <= 768px) 'small-400', 'small-500'`}
                border={boxBorder}
                borderRadius={boxBorderRadius}
                padding={boxPadding}
                background={boxBackground}

                {...rest}
            >
                <div className="tabs-scroll-wrapper" role="tablist">
                    {fullWidth ? (
                        <Grid
                            gridTemplateColumns={`repeat(${tabs.length || 1}, minmax(0, 1fr))`}
                            gap={gap}
                        >
                            {tabs.map((tab, index) => (
                                <GridItem key={tab.id || index} minInlineSize="0">
                                    <TabButton
                                        tab={tab}
                                        index={index}
                                        isSelected={selectedTab === tab.id}
                                        onClick={() => handleTabClick(tab.id)}
                                        variant={variant}
                                        fullWidth={fullWidth}
                                        inlineSize={inlineSize}
                                    />
                                </GridItem>
                            ))}
                        </Grid>
                    ) : (
                        <Stack direction="inline" gap={gap}>
                            {tabs.map((tab, index) => (
                                <TabButton
                                    key={tab.id || index}
                                    tab={tab}
                                    index={index}
                                    isSelected={selectedTab === tab.id}
                                    onClick={() => handleTabClick(tab.id)}
                                    variant={variant}
                                    fullWidth={fullWidth}
                                    inlineSize={inlineSize}
                                />
                            ))}
                        </Stack>
                    )}
                </div>
            </Box>
        </QueryContainer>
    );
};

Tabs.propTypes = {
    tabs: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string,
            content: PropTypes.node,
            icon: PropTypes.string,
            disabled: PropTypes.bool,
            id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        })
    ).isRequired,
    selected: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    onSelect: PropTypes.func,
    variant: PropTypes.oneOf(["primary", "secondary", "tertiary"]),
    gap: PropTypes.string,
    containerName: PropTypes.string,
    boxBackground: PropTypes.oneOf(["transparent", "base"]),
    boxBorder: PropTypes.oneOf(["none", "base"]),
    boxBorderRadius: PropTypes.oneOf(["none", "base"]),
    boxPadding: PropTypes.string,
    fullWidth: PropTypes.bool,
    inlineSize: PropTypes.string,
};

const TabPanel = memo(({ children }) => {
    return <Fragment>{children}</Fragment>;
});

TabPanel.displayName = 'TabPanel';

TabPanel.propTypes = {
    children: PropTypes.node,
};


export { TabPanel, Tabs };

