import React from "react";
import PropTypes from "prop-types";
import { Box, Clickable, Icon, Stack, Text, Tooltip } from "./";
import { Icons } from "../../utils/Icons";

/**
 * TabsBlock Component using Box + s-clickable structure (Vertical Column Layout)
 * @param {Array} tabs - List of tab objects { id, label }
 * @param {string} selected - Currently selected tab id
 * @param {function} onSelect - Callback for tab selection
 * @param {React.ReactNode} children - Optional children content
 */

const TabsBlock = ({ tabs = [], selected = '', onSelect = () => { } }) => {
    return (
        <Box padding="small-300" border="base" borderRadius="base" background="base">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "5px" }}>
                {(tabs || []).map((tab) => {
                    const isSelected = selected === tab.id;

                    return (
                        <Clickable
                            key={tab.id}
                            onClick={() => onSelect(tab.id)}
                            padding="small-200"
                            borderRadius="base"
                            textAlign="left"
                            background={isSelected ? "subdued" : "base"}
                        >
                            <Stack direction="inline" gap={"small-100"} alignContent={'center'} justifyContent="space-between">
                                <Stack direction="inline" gap="small-300" alignItems="center">
                                    <Text type={isSelected ? "strong" : "generic"}>{tab.label}</Text>
                                    {tab.hasIcon && (
                                        <Stack direction="inline" gap="small-300" >
                                            <>
                                                <Tooltip id={tab.id}>{tab.tooltip}</Tooltip>
                                                <Text interestFor={tab.id}> <span className="tooltip-crown">{Icons.Crown}</span></Text>
                                            </>
                                        </Stack>
                                    )}
                                </Stack>
                                <Icon size="base" type={isSelected ? "check" : "none"} />
                            </Stack>
                        </Clickable>
                    );
                })}
            </div>
        </Box>
    );
}

TabsBlock.propTypes = {
    tabs: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        content: PropTypes.string.isRequired,
    })).isRequired,
    selected: PropTypes.string.isRequired,
    onSelect: PropTypes.func.isRequired,
    children: PropTypes.node,
}

export default TabsBlock;