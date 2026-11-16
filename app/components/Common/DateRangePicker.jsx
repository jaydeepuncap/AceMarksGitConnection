import React, { useEffect, useRef, useState } from "react";

import dayjs from "dayjs";
import { Box, Button, Clickable, DatePicker, Grid, Icon, Popover, Stack, TextField } from "../ui";

const DateRangePicker = ({ onChange, primary = "primary", disabled, activeRange = 3, disableFutureDates = true }) => {
    const currentDate = dayjs();
    const clampPresetDate = (date) => {
        if (disableFutureDates && date.isAfter(currentDate, "day")) {
            return currentDate.toDate();
        }
        return date.toDate();
    };

    const ranges = [
        {
            title: "Today",
            alias: "today",
            period: {
                since: dayjs().toDate(),
                until: dayjs().toDate(),
            },
        },
        {
            title: "Yesterday",
            alias: "yesterday",
            period: {
                since: dayjs().subtract(1, "day").toDate(),
                until: dayjs().subtract(1, "day").toDate(),
            },
        },
        {
            title: "Last 7 days",
            alias: "last7days",
            period: {
                since: dayjs().subtract(6, "day").toDate(),
                until: dayjs().toDate(),
            },
        },
        {
            title: "Last 30 Days",
            alias: "last30days",
            period: {
                since: dayjs().subtract(29, "day").toDate(),
                until: dayjs().toDate(),
            },
        },
        {
            title: "Last 90 Days",
            alias: "last90days",
            period: {
                since: dayjs().subtract(89, "day").toDate(),
                until: dayjs().toDate(),
            },
        },
        {
            title: "This Month",
            alias: "thisMonth",
            period: {
                since: dayjs().startOf("month").toDate(),
                until: clampPresetDate(dayjs().endOf("month")),
            },
        },
        {
            title: "Last Month",
            alias: "lastMonth",
            period: {
                since: dayjs().subtract(1, "month").startOf("month").toDate(),
                until: dayjs().subtract(1, "month").endOf("month").toDate(),
            },
        },
        // {
        //     title: "Custom",
        //     alias: "custom",
        //     period: {
        //         since: dayjs().subtract(7, "day").toDate(),
        //         until: dayjs().toDate(),
        //     },
        // },
    ];

    const [popoverActive, setPopoverActive] = useState(false);
    const [activeDateRange, setActiveDateRange] = useState(ranges[activeRange]);
    const [inputValues, setInputValues] = useState({});

    const [buttonLabel, setButtonLabel] = useState(activeDateRange.title);

    const datePickerRef = useRef(null);
    const lastClampedRef = useRef(null);

    const VALID_YYYY_MM_DD_DATE_REGEX = /^\d{4}-\d{1,2}-\d{1,2}/;

    function isDate(date) {
        return !isNaN(new Date(date).getDate());
    }
    function isValidYearMonthDayDateString(date) {
        return VALID_YYYY_MM_DD_DATE_REGEX.test(date) && isDate(date);
    }
    function isValidDate(date) {
        return date.length === 10 && isValidYearMonthDayDateString(date);
    }

    function parseYearMonthDayDateString(input) {
        const [year, month, day] = input.split("-");
        return new Date(Number(year), Number(month) - 1, Number(day));
    }
    function formatDateToYearMonthDayDateString(date) {
        const year = String(date.getFullYear());
        let month = String(date.getMonth() + 1).padStart(2, "0");
        let day = String(date.getDate()).padStart(2, "0");
        return [year, month, day].join("-");
    }
    function formatDate(date) {
        return formatDateToYearMonthDayDateString(date);
    }
    function formatDisplayDate(date) {
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }

    // Get today's date for max date restriction
    const today = dayjs().toDate();
    const todayFormatted = formatDateToYearMonthDayDateString(today);

    // Create allow prop for DatePicker to restrict future dates
    const getAllowProp = () => {
        if (disableFutureDates) {
            // Allow all dates up to today (using a very early date as start)
            return `1900-01-01--${todayFormatted}`;
        }
        return undefined;
    };

    // Helper function to clamp date to today if future dates are disabled
    const clampToToday = (date) => {
        if (disableFutureDates && date > today) {
            return today;
        }
        return date;
    };

    function handleStartInputValueChange(data) {
        const value = data.target.value;
        setInputValues((prev) => ({ ...prev, since: value }));

        if (isValidDate(value)) {
            let newSince = parseYearMonthDayDateString(value);

            // Clamp to today if future dates are disabled
            if (disableFutureDates) {
                newSince = clampToToday(newSince);
                // Update input value if it was clamped
                if (newSince < parseYearMonthDayDateString(value)) {
                    setInputValues((prev) => ({ ...prev, since: formatDate(newSince) }));
                }
            }

            setActiveDateRange((prev) => {
                let until = prev.period?.until || newSince;
                // Ensure until is not in the future
                if (disableFutureDates) {
                    until = clampToToday(until);
                }
                const newPeriod =
                    newSince <= until
                        ? { since: newSince, until: until }
                        : { since: newSince, until: newSince };
                return { ...prev, period: newPeriod, alias: "custom", title: "Custom" };
            });
        }
    }

    function handleEndInputValueChange(data) {
        const value = data.target.value;
        setInputValues((prev) => ({ ...prev, until: value }));

        if (isValidDate(value)) {
            let newUntil = parseYearMonthDayDateString(value);

            // Clamp to today if future dates are disabled
            if (disableFutureDates) {
                newUntil = clampToToday(newUntil);
                // Update input value if it was clamped
                if (newUntil < parseYearMonthDayDateString(value)) {
                    setInputValues((prev) => ({ ...prev, until: formatDate(newUntil) }));
                }
            }

            setActiveDateRange((prev) => {
                let since = prev.period?.since || newUntil;
                // Ensure since is not in the future
                if (disableFutureDates) {
                    since = clampToToday(since);
                }
                const newPeriod =
                    newUntil >= since
                        ? { since: since, until: newUntil }
                        : { since: newUntil, until: newUntil };
                return { ...prev, period: newPeriod, alias: "custom", title: "Custom" };
            });
        }
    }

    function handleDatePickerChange(event) {
        const dateRangeValue = event.currentTarget.value;
        const [startDateStr, endDateStr] = dateRangeValue.split("--");

        if (startDateStr && endDateStr && isValidDate(startDateStr) && isValidDate(endDateStr)) {
            let startDate = parseYearMonthDayDateString(startDateStr);
            let endDate = parseYearMonthDayDateString(endDateStr);

            // Clamp dates to today if future dates are disabled
            if (disableFutureDates) {
                startDate = clampToToday(startDate);
                endDate = clampToToday(endDate);
            }

            const matchedRange = ranges.find((range) => {
                return (
                    formatDate(range.period.since) === formatDate(startDate) &&
                    formatDate(range.period.until) === formatDate(endDate)
                );
            });

            if (matchedRange) {
                setActiveDateRange(matchedRange);
            } else {
                setActiveDateRange({
                    alias: "custom",
                    title: "Custom",
                    period: { since: startDate, until: endDate },
                });
            }
        }
    }

    function apply() {
        setPopoverActive(false);
        const buttonValue =
            activeDateRange.title === "Custom"
                ? `${startDateDisplay} To ${endDateDisplay}`
                : activeDateRange.title;
        setButtonLabel(buttonValue);
        onChange({
            startDate: activeDateRange.period.since,
            endDate: activeDateRange.period.until,
        });
    }

    function cancel() {
        setPopoverActive(false);
    }

    useEffect(() => {
        if (activeDateRange) {
            setInputValues({
                since: formatDate(activeDateRange.period.since),
                until: formatDate(activeDateRange.period.until),
            });
        }
    }, [activeDateRange]);

    // Separate effect to clamp dates when disableFutureDates changes
    useEffect(() => {
        if (activeDateRange && disableFutureDates) {
            const clampedSince = clampToToday(activeDateRange.period.since);
            const clampedUntil = clampToToday(activeDateRange.period.until);

            // Check if we've already clamped these exact dates to prevent loops
            const _currentKey = `${activeDateRange.period.since.getTime()}-${activeDateRange.period.until.getTime()}`;
            const clampedKey = `${clampedSince.getTime()}-${clampedUntil.getTime()}`;

            // Only update if dates need clamping and we haven't already processed this exact range
            if ((clampedSince.getTime() !== activeDateRange.period.since.getTime() ||
                clampedUntil.getTime() !== activeDateRange.period.until.getTime()) &&
                lastClampedRef.current !== clampedKey) {
                lastClampedRef.current = clampedKey;
                setActiveDateRange((prev) => ({
                    ...prev,
                    period: { since: clampedSince, until: clampedUntil },
                }));
            }
        } else if (!disableFutureDates) {
            // Reset ref when future dates are enabled
            lastClampedRef.current = null;
        }
    }, [disableFutureDates, activeDateRange]);

    const startDateDisplay = formatDisplayDate(activeDateRange.period.since);
    const endDateDisplay = formatDisplayDate(activeDateRange.period.until);

    return (
        <>
            <Button
                commandFor="date-range-picker-popover"
                icon={"calendar"}
                onClick={() => setPopoverActive(!popoverActive)}
                variant={primary}
                disabled={disabled}
            >
                {buttonLabel}
            </Button>

            <Popover id={"date-range-picker-popover"} onHide={() => setPopoverActive(false)}>
                <Box padding="base">
                    <Grid gridTemplateColumns="auto 1fr" gap="base" ref={datePickerRef}>
                        <Box paddingBlockEnd="100" paddingInlineStart="none" inlineSize={"160px"}>
                            {ranges.map((range) => {
                                return (
                                    <Clickable
                                        padding="small-300"
                                        key={range.alias}
                                        onClick={() => setActiveDateRange(range)}
                                        borderRadius="small"
                                        background={activeDateRange.alias === range.alias ? "strong" : "transparent"}
                                    >
                                        <Stack direction="inline" alignItems="center">
                                            <Box inlineSize={"120px"}>{range.title}</Box>
                                            {activeDateRange.alias === range.alias && <Icon type={"check"} />}
                                        </Stack>
                                    </Clickable>
                                );
                            })}
                        </Box>

                        <Box paddingInlineStart="none" paddingInlineEnd="none" paddingBlockEnd="base">
                            <Stack gap="base">
                                <Stack direction="inline" gap="small-500" alignItems="center" justifyContent="space-between">
                                    <Box inlineSize={"100px"}>
                                        <TextField
                                            value={inputValues.since}
                                            onChange={handleStartInputValueChange}
                                            autoComplete="off"
                                        />
                                    </Box>
                                    <Icon type={"arrow-right"} />
                                    <Box inlineSize={"100px"}>
                                        <TextField
                                            value={inputValues.until}
                                            onChange={handleEndInputValueChange}
                                            autoComplete="off"
                                        />
                                    </Box>
                                </Stack>

                                <Box>
                                    <DatePicker
                                        type="range"
                                        name="order-date-range"
                                        value={`${formatDate(activeDateRange.period.since)}--${formatDate(
                                            activeDateRange.period.until
                                        )}`}
                                        onChange={handleDatePickerChange}
                                        allow={getAllowProp()}
                                    />
                                </Box>
                            </Stack>
                        </Box>
                    </Grid>

                    <Stack direction="inline" justifyContent="end" alignItems="end" gap="small">
                        <Button commandFor={'date-range-picker-popover'} onClick={cancel}>{"Cancel"}</Button>
                        <Button commandFor={'date-range-picker-popover'} variant="primary" onClick={apply}>
                            {"Apply"}
                        </Button>
                    </Stack>
                </Box>
            </Popover>
        </>
    );
};

export default React.memo(DateRangePicker);
