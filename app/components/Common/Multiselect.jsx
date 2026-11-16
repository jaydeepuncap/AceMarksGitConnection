import React, { useId, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Box, Clickable, ClickableChip, Popover, Stack, Text, TextField } from "../ui";

function getDisplayValue(item, displayValue) {
    if (item == null) return "";
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (displayValue && typeof item === "object" && displayValue in item) return String(item[displayValue] ?? "");
    return String(item?.label ?? item?.name ?? item?.value ?? "");
}

function getOptionValue(option, valueKey) {
    if (option == null) return undefined;
    if (typeof option === "string" || typeof option === "number") return option;
    if (valueKey && typeof option === "object" && valueKey in option) return option[valueKey];
    return option?.value ?? option?.id;
}

const Multiselect = ({
    options = [],
    selectedValues = [],
    onSelect,
    onRemove,
    displayValue = "name",
    valueKey = "value",
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    label = "",
    error = "",
    disabled = false,
}) => {
    const popoverId = useId();
    const [searchQuery, setSearchQuery] = useState("");

    const selectedSet = useMemo(() => {
        return new Set(
            (selectedValues || []).map((s) => getOptionValue(s, valueKey)).filter((v) => v !== undefined),
        );
    }, [selectedValues, valueKey]);

    const availableOptions = useMemo(() => {
        return (options || []).filter((opt) => !selectedSet.has(getOptionValue(opt, valueKey)));
    }, [options, selectedSet, valueKey]);

    const filteredOptions = useMemo(() => {
        const q = (searchQuery || "").trim().toLowerCase();
        if (!q) return availableOptions;
        return availableOptions.filter((opt) =>
            getDisplayValue(opt, displayValue).toLowerCase().includes(q),
        );
    }, [availableOptions, searchQuery, displayValue]);

    const handleSelect = (option) => {
        if (disabled) return;
        const nextList = [...(selectedValues || []), option];
        onSelect?.(nextList, option);
    };

    const handleRemove = (itemToRemove) => {
        if (disabled) return;
        const nextList = (selectedValues || []).filter(
            (item) => getOptionValue(item, valueKey) !== getOptionValue(itemToRemove, valueKey),
        );
        onRemove?.(nextList, itemToRemove);
    };

    const handleTriggerKeyDown = (e) => {
        if (disabled) return;
        if (e.key === "Backspace" && (selectedValues || []).length > 0) {
            e.preventDefault();
            handleRemove(selectedValues[selectedValues.length - 1]);
        }
    };

    return (
        <Stack gap="small-200" inlineSize="100%">
            {!!label && (
                <Text type="strong">
                    {label}
                </Text>
            )}

            <Box
                border={selectedValues.length > 0 ? "base" : "none"}
                borderRadius={selectedValues.length > 0 ? "base" : "none"}
                borderColor={selectedValues.length > 0 ? "strong" : "none"}
                padding={selectedValues.length > 0 ? "small-300" : "none"}
                background={selectedValues.length > 0 ? (disabled ? "subdued" : "base") : ""}
            >
                <Stack direction="inline" gap="small-200" padding="none" alignItems="center">
                    {(selectedValues || []).map((item, idx) => (
                        <ClickableChip
                            key={`${getOptionValue(item, valueKey)}-${idx}`}
                            removable
                            disabled={disabled}
                            onRemove={() => handleRemove(item)}
                            accessibilityLabel={`Remove ${getDisplayValue(item, displayValue)}`}
                        >
                            {getDisplayValue(item, displayValue)}
                        </ClickableChip>
                    ))}

                    <Clickable
                        commandFor={popoverId}
                        command="--show"
                        padding="none"
                        disabled={disabled}
                        inlineSize="auto"
                        minInlineSize="120px"
                    >
                        <TextField
                            readOnly
                            placeholder={placeholder}
                            onKeyDown={handleTriggerKeyDown}
                            disabled={disabled}
                            error={error}
                        />
                    </Clickable>
                </Stack>
            </Box>

            <Popover
                id={popoverId}
                inlineSize="320px"
                maxInlineSize="320px"
                onHide={() => setSearchQuery("")}
            >
                <Stack gap="small-200">
                    <Box paddingBlockStart="small-200" paddingInline="small-200">
                        <TextField
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onInput={(e) => setSearchQuery(e?.target?.value ?? "")}
                            onChange={(e) => setSearchQuery(e?.target?.value ?? "")}
                        />
                    </Box>
                    <Box padding="small-200" paddingBlockStart="none" maxBlockSize="280px" blockSize="280px" overflow="auto">
                        <Stack gap="small-200" >
                            {filteredOptions.map((option) => (
                                <Clickable key={getOptionValue(option, valueKey)} padding="small-400" onClick={() => handleSelect(option)}>
                                    {getDisplayValue(option, displayValue)}
                                </Clickable>
                            ))}
                        </Stack>
                        {filteredOptions.length === 0 && (
                            <Stack padding="small-400" alignItems="center" justifyContent="center">
                                <Text tone="subdued" type="generic">
                                    No results found
                                </Text>
                            </Stack>
                        )}
                    </Box>
                </Stack>
            </Popover>
        </Stack>
    );
};

Multiselect.propTypes = {
    options: PropTypes.array,
    selectedValues: PropTypes.array,
    onSelect: PropTypes.func,
    onRemove: PropTypes.func,
    displayValue: PropTypes.string,
    valueKey: PropTypes.string,
    placeholder: PropTypes.string,
    searchPlaceholder: PropTypes.string,
    label: PropTypes.string,
    error: PropTypes.string,
    disabled: PropTypes.bool,
};

export default React.memo(Multiselect);
