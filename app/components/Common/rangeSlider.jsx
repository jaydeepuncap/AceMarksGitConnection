import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Grid, Stack, Text } from "../ui";

const RangeSlider = ({
  id,
  name,
  label,
  details,
  min,
  max,
  step = 1,
  value,
  defaultValue,
  prefix,
  suffix,
  output = false,
  disabled,
  readOnly,
  required,
  error,
  labelAccessibilityVisibility = "visible",
  onBlur,
  onChange,
  onFocus,
  onInput,
  ...rest
}) => {
  const reactId = useId();
  const inputId = id || `${name || "range"}-${reactId}`;

  const numericMin = typeof min === "number" ? min : 0;
  const numericMax = typeof max === "number" ? max : 100;
  const numericValue = useMemo(() => {
    const raw = value ?? defaultValue ?? numericMin;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isNaN(n)) return numericMin;
    return Math.min(numericMax, Math.max(numericMin, n));
  }, [defaultValue, numericMax, numericMin, value]);

  const percent =
    numericMax === numericMin
      ? 0
      : ((numericValue - numericMin) / (numericMax - numericMin)) * 100;

  const showLabel = labelAccessibilityVisibility !== "exclusive" && !!label;

  const trackRef = useRef(null);
  const bubbleRef = useRef(null);
  const [bubbleLeftPx, setBubbleLeftPx] = useState(null);
  const [isInteracting, setIsInteracting] = useState(false);

  useEffect(() => {
    if (!isInteracting) return;

    const onPointerUp = () => setIsInteracting(false);
    const onPointerCancel = () => setIsInteracting(false);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") setIsInteracting(false);
    };

    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isInteracting]);

  useLayoutEffect(() => {
    if (!output || !isInteracting) return;

    const trackEl = trackRef.current;
    const bubbleEl = bubbleRef.current;
    if (!trackEl || !bubbleEl) return;

    const thumbSizePx = 16; // close to Polaris default; used for edge clamping

    const recalc = () => {
      const trackWidth = trackEl.clientWidth || 0;
      const bubbleWidth = bubbleEl.offsetWidth || 0;
      if (trackWidth <= 0 || bubbleWidth <= 0) return;

      const x =
        (percent / 100) * Math.max(0, trackWidth - thumbSizePx) + thumbSizePx / 2;
      const minX = bubbleWidth / 2;
      const maxX = trackWidth - bubbleWidth / 2;
      const clampedX = Math.min(maxX, Math.max(minX, x));
      setBubbleLeftPx(clampedX);
    };

    recalc();

    const ro = new ResizeObserver(() => recalc());
    ro.observe(trackEl);
    ro.observe(bubbleEl);

    return () => ro.disconnect();
  }, [output, percent]);

  return (
    <Stack gap="small-200">

      <Stack gap="small-200">
        {showLabel ? (
          <Text interestFor={inputId}>  {label}  </Text>
        ) : null}

        <div
          style={{
            position: "relative",
          }}
        >
          <Grid gridTemplateColumns="auto 1fr auto" gap="small-200">
            {(prefix) ? (
              <Text color="subdued"> {prefix}</Text>
            ) : null}
            <div ref={trackRef} style={{ position: "relative" }}>
              {output && isInteracting ? (
                <div
                  ref={bubbleRef}
                  style={{
                    position: "absolute",
                    left: bubbleLeftPx == null ? `${percent}%` : `${bubbleLeftPx}px`,
                    top: -30,
                    transform: "translateX(-50%)",
                    pointerEvents: "none",
                    background: "#fff",
                    border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                    fontSize: 13,
                    lineHeight: "16px",
                    color: "#202223",
                    minWidth: 10,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {numericValue}
                </div>
              ) : null}

              <input
                id={inputId}
                name={name}
                type="range"
                min={numericMin}
                max={numericMax}
                step={step}
                value={value ?? numericValue}
                disabled={disabled}
                readOnly={readOnly}
                required={required}
                aria-invalid={!!error}
                onPointerDown={(e) => {
                  setIsInteracting(true);
                  rest?.onPointerDown?.(e);
                }}
                onBlur={(e) => {
                  setIsInteracting(false);
                  onBlur?.(e);
                }}
                onFocus={(e) => {
                  setIsInteracting(true);
                  onFocus?.(e);
                }}
                onChange={onChange}
                onInput={onInput}
                style={{
                  width: "100%",
                }}
                {...rest}
              />
            </div>
            {(suffix) ? (
              <Text color="subdued"> {suffix}</Text>
            ) : null}
          </Grid>
        </div>
      </Stack>

      {details ? (
        <Text color="subdued">
          {details}
        </Text>
      ) : null}
      {error ? (
        <Text color="critical">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
};

RangeSlider.propTypes = {
  /** Identification */
  id: PropTypes.string,
  name: PropTypes.string,

  /** Content */
  label: PropTypes.string,
  details: PropTypes.string,
  labelAccessibilityVisibility: PropTypes.oneOf(["visible", "exclusive"]),

  /** Values */
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  defaultValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),

  /** Limits */
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,

  /** Prefix/Suffix */
  prefix: PropTypes.string,
  suffix: PropTypes.string,

  /** Behavior */
  output: PropTypes.bool,

  /** State */
  disabled: PropTypes.bool,
  readOnly: PropTypes.bool,
  required: PropTypes.bool,
  error: PropTypes.string,

  /** Events */
  onBlur: PropTypes.func,
  onChange: PropTypes.func,
  onFocus: PropTypes.func,
  onInput: PropTypes.func,
};

export default React.memo(RangeSlider);

