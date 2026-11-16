import React, { useId, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Box, Clickable, ClickableChip, Popover, Stack, Text, TextField } from "../ui";
import { paymentMethodChoices } from "../../utils/Constent";

function normalize(value) {
    return (value || "").toString().trim().toLowerCase();
}

function getDisplayValue(item) {
    if (item == null) return "";
    if (typeof item === "string" || typeof item === "number") return String(item);
    return String(item?.label ?? item?.name ?? item?.value ?? "");
}

const PaymentMethodSelect = ({
    options = paymentMethodChoices,
    selectedValues = [],
    onSelect,
    onRemove,
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    label = "",
    error = "",
    disabled = false,
}) => {
    const popoverId = useId();
    const [searchQuery, setSearchQuery] = useState("");

    const getEventValue = (e) => {
        return (
            e?.target?.value ??
            e?.currentTarget?.value ??
            e?.detail?.value ??
            e?.value ??
            e?.nativeEvent?.target?.value ??
            ""
        );
    };

    const trimmedQuery = (searchQuery || "").trim();
    const normalizedQuery = normalize(trimmedQuery);

    const hasExactMatch = useMemo(() => {
        if (!normalizedQuery) return false;
        return (options || []).some((opt) => normalize(opt) === normalizedQuery);
    }, [options, normalizedQuery]);

    const canAddCustom = trimmedQuery.length > 0 && !hasExactMatch;

    const filteredOptions = useMemo(() => {
        const q = (searchQuery || "").toLowerCase();
        if (!q) return options;
        return options.filter((opt) =>
            getDisplayValue(opt).toLowerCase().includes(q)
        );
    }, [options, searchQuery]);

    // ✅ SINGLE SELECT
    const handleSelect = (option) => {
        if (disabled) return;
        onSelect?.([option], option); // 👈 always single
        setSearchQuery("");
    };

    const commitCustomValue = (rawValue) => {
        if (disabled) return;
        const cleaned = (rawValue || "").toString().trim();
        if (!cleaned) return;
        onSelect?.([cleaned], cleaned);
        setSearchQuery("");
    };

    const handleRemove = () => {
        if (disabled) return;
        onRemove?.([], null);
    };

    return (
        <Stack gap="small-400" inlineSize="100%">
            {!!label && <Text type="strong">{label}</Text>}

            <Box
                border={selectedValues.length > 0 ? "base" : "none"}
                borderRadius="base"
                borderColor="strong"
                padding={selectedValues.length > 0 ? "small-300" : "none"}
            >
                <Stack direction="inline" gap="small-200" alignItems="center">
                    <Clickable
                        commandFor={popoverId}
                        command="--show"
                        inlineSize="auto"
                        minInlineSize="120px"
                    >
                        <TextField
                            // value={searchQuery}
                            placeholder={placeholder}
                            disabled={disabled}
                            error={error}
                            icon="search"
                            onKeyDown={(e) => e.preventDefault()}
                            onPaste={(e) => e.preventDefault()}
                            // onInput={(e) => setSearchQuery(getEventValue(e))}
                            // onChange={(e) => setSearchQuery(getEventValue(e))}
                            onFocus={() => {
                                // Ensures popover opens even if user focuses without clicking.
                                // (Clickable handles click; focus sometimes doesn't trigger it.)
                                // The actual opening is handled by Polaris `commandFor`.
                            }}
                            // onKeyDown={(e) => {
                            //     if (e.key === " " || e.code === "Space") {
                            //         e.stopPropagation();   // ✅ only this
                            //         return;                // space will still be typed
                            //     }
                            //     if (e.key !== "Enter") return;
                            //     e.preventDefault();
                            //     if (!trimmedQuery) return;

                            //     if (hasExactMatch) {
                            //         const exact = (options || []).find((opt) => normalize(opt) === normalizedQuery);
                            //         if (exact != null) handleSelect(exact);
                            //         return;
                            //     }

                            //     if (canAddCustom) {
                            //         commitCustomValue(trimmedQuery);
                            //     }
                            // }}
                            autocomplete="off"
                        />
                    </Clickable>

                    {selectedValues.length > 0 && (
                        <ClickableChip
                            removable
                            disabled={disabled}
                            onRemove={handleRemove}
                        >
                            {getDisplayValue(selectedValues[0])}
                        </ClickableChip>
                    )}
                </Stack>
            </Box>

            <Popover
                id={popoverId}
                inlineSize="300px"
                onHide={() => setSearchQuery("")}
            >
                <Stack gap="small-400">
                    <Box padding="small-200">
                        <TextField
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            // readOnly
                            // tabIndex={-1}
                            onInput={(e) => setSearchQuery(getEventValue(e))}
                            onChange={(e) => setSearchQuery(getEventValue(e))}
                            onFocus={() => {
                                // Ensures popover opens even if user focuses without clicking.
                                // (Clickable handles click; focus sometimes doesn't trigger it.)
                                // The actual opening is handled by Polaris `commandFor`.
                            }}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                if (!trimmedQuery) return;

                                if (hasExactMatch) {
                                    const exact = (options || []).find((opt) => normalize(opt) === normalizedQuery);
                                    if (exact != null) handleSelect(exact);
                                    return;
                                }

                                if (canAddCustom) {
                                    commitCustomValue(trimmedQuery);
                                }
                            }}
                            icon="search"
                        />
                    </Box>

                    <Box maxBlockSize="280px" overflow="auto" padding="small-200" paddingBlockStart="none">
                        <Stack gap="small-400">
                            {/* <Box padding="small-200"> */}
                            <Text type="generic" color="subdued">
                                Start typing to search, press Enter to add a custom payment method
                            </Text>
                            {/* </Box> */}

                            {canAddCustom ? (
                                <Clickable
                                    padding="small-400" paddingInline="small-200" borderRadius="small"
                                    onClick={() => commitCustomValue(trimmedQuery)}
                                    command="--hide" background="subdued"
                                    commandFor={popoverId}
                                >
                                    <Text type="strong">{`Add "${trimmedQuery}"`}</Text>
                                </Clickable>
                            ) : null}

                            {filteredOptions.map((option, idx) => (
                                <Clickable
                                    key={idx}
                                    padding="small-400" paddingInline="small-200" borderRadius="small"
                                    onClick={() => handleSelect(option)}
                                    command="--hide"
                                    commandFor={popoverId}
                                >
                                    {getDisplayValue(option)}
                                </Clickable>
                            ))}
                        </Stack>

                        {filteredOptions.length === 0 && !canAddCustom && (
                            <Text tone="subdued">No results found</Text>
                        )}
                    </Box>
                </Stack>
            </Popover>
        </Stack>
    );
};

PaymentMethodSelect.propTypes = {
    options: PropTypes.array,
    selectedValues: PropTypes.array,
    onSelect: PropTypes.func,
    onRemove: PropTypes.func,
    placeholder: PropTypes.string,
    searchPlaceholder: PropTypes.string,
    label: PropTypes.string,
    error: PropTypes.string,
    disabled: PropTypes.bool,
};

export default React.memo(PaymentMethodSelect);