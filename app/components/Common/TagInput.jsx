import React, { useCallback, useId, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Box, ClickableChip, Stack, Text, TextField } from "../ui";

const DEFAULT_ADD_KEYS = [9, 13, 188]; // Tab, Enter, Comma

function getTagLabel(tag, tagDisplayProp) {
    if (tag == null) return "";
    if (typeof tag === "string" || typeof tag === "number") return String(tag);
    if (tagDisplayProp && typeof tag === "object" && tagDisplayProp in tag) return String(tag[tagDisplayProp] ?? "");
    return String(tag?.label ?? tag?.value ?? "");
}

function normalizeCandidate(raw) {
    const v = String(raw ?? "").trim();
    if (!v) return "";
    return v.replace(/\s+/g, " ");
}

const TagInput = ({
    hideInput = false,
    value = [],
    onChange,
    placeholder = "",
    label = "",
    details = "",
    error = "",
    disabled = false,
    onlyUnique = true,
    addKeys = DEFAULT_ADD_KEYS,
    tagDisplayProp = "",
    onBlurAdd = false,
    maxTags,
    inputProps,
    onFocus,
}) => {
    const id = useId();
    const [draft, setDraft] = useState("");

    const normalizedExisting = useMemo(() => {
        return new Set(
            (Array.isArray(value) ? value : [])
                .map((t) => normalizeCandidate(getTagLabel(t, tagDisplayProp)).toLowerCase())
                .filter(Boolean),
        );
    }, [value, tagDisplayProp]);

    const canAddMore = typeof maxTags === "number" ? (value?.length || 0) < maxTags : true;

    const commitDraft = useCallback((raw) => {
        if (disabled) return;
        if (!canAddMore) return;

        const next = normalizeCandidate(raw ?? draft);
        if (!next) return;

        if (onlyUnique) {
            const key = next.toLowerCase();
            if (normalizedExisting.has(key)) {
                setDraft("");
                return;
            }
        }

        const current = Array.isArray(value) ? value : [];
        onChange?.([...current, next]);
        setDraft("");
    }, [disabled, canAddMore, draft, onlyUnique, normalizedExisting, onChange, value]);

    const removeAt = useCallback(
        (idx) => {
            if (disabled) return;
            const current = Array.isArray(value) ? value : [];
            if (idx < 0 || idx >= current.length) return;
            const next = current.filter((_, i) => i !== idx);
            onChange?.(next);
        },
        [disabled, onChange, value],
    );

    const onKeyDown = useCallback(
        (e) => {
            if (disabled) return;

            const keyCode = e?.keyCode;
            const key = e?.key;
            const isAddKey =
                (typeof keyCode === "number" && (addKeys || []).includes(keyCode)) ||
                key === "Enter" ||
                key === "Tab" ||
                key === ",";

            if (isAddKey) {
                e.preventDefault();
                commitDraft(e?.target?.value);
                return;
            }

            if (key === "Backspace" && !draft) {
                const current = Array.isArray(value) ? value : [];
                if (current.length > 0) {
                    e.preventDefault();
                    removeAt(current.length - 1);
                }
            }
        },
        [addKeys, commitDraft, disabled, draft, removeAt, value],
    );

    return (
        <Stack gap="small-400" inlineSize="100%">
            {!!label && <Text type="strong">{label}</Text>}

            <Box
                border={value.length > 0 ? "base" : "none"}
                borderRadius={value.length > 0 ? "base" : "none"}
                borderColor={value.length > 0 ? "strong" : "none"}
                padding={value.length > 0 ? "small-300" : "none"}
                background={value.length > 0 ? (disabled ? "subdued" : "base") : ""}
            >
                <Stack direction="inline" gap="small-200" alignItems="center">
                    {(Array.isArray(value) ? value : []).map((tag, idx) => {
                        const text = getTagLabel(tag, tagDisplayProp);
                        return (
                            <ClickableChip
                                key={`${text}-${idx}`}
                                removable
                                disabled={disabled}
                                onRemove={() => removeAt(idx)}
                                accessibilityLabel={`Remove ${text}`}
                            >
                                {text}
                            </ClickableChip>
                        );
                    })}

                    {!hideInput && <TextField
                        id={id}
                        label={label || "Tags"}
                        labelAccessibilityVisibility="exclusive"
                        value={draft}
                        placeholder={placeholder}
                        disabled={disabled || !canAddMore}
                        onInput={(event) => setDraft(event?.target?.value || "")}
                        onChange={(event) => setDraft(event?.target?.value || "")}
                        onKeyDown={onKeyDown}
                        onBlur={(event) => {
                            if (onBlurAdd) {
                                commitDraft(event?.target?.value);
                            }
                        }}
                        onFocus={onFocus}
                        // Try to make the inner input blend into the outer Box.
                        // These props are passed through to the underlying `s-text-field`.
                        border="none"
                        background="transparent"
                        padding="none"
                        inlineSize="fill"
                        error={error}
                        {...(inputProps || {})}
                    />}
                </Stack>
            </Box>

            {!!details && (
                <Text color="subdued">
                    {details}
                </Text>
            )}
        </Stack>
    );
};

TagInput.propTypes = {
    value: PropTypes.array,
    onChange: PropTypes.func,
    placeholder: PropTypes.string,
    label: PropTypes.string,
    details: PropTypes.string,
    error: PropTypes.string,
    disabled: PropTypes.bool,
    onlyUnique: PropTypes.bool,
    addKeys: PropTypes.arrayOf(PropTypes.number),
    tagDisplayProp: PropTypes.string,
    onBlurAdd: PropTypes.bool,
    maxTags: PropTypes.number,
    inputProps: PropTypes.object,
    onFocus: PropTypes.func,
};

export default React.memo(TagInput);

