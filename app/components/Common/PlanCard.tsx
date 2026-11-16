import {
  Badge,
  Button,
  Divider,
  Heading,
  Icon,
  Paragraph,
  Stack,
  Text,
} from "../ui";
import type { AppPlan } from "../../types";

/**
 * Shared plan card. Used by:
 *   - PlanSelection (install-time subscription gate)
 *   - settings/PlanAndPrice (in-app upgrade/downgrade)
 *
 * Renders as a self-contained card. Callers should not wrap a grid of these
 * inside another Section — that produces a visibly nested-card layout.
 */

type Props = {
  plan: AppPlan;
  current?: boolean;
  loading?: boolean;
  onSelect?: (planId: number) => void;
};

function formatPriceParts(amount: number, currency: string | null) {
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  };
  try {
    const parts = new Intl.NumberFormat(undefined, opts).formatToParts(amount);
    const currencySymbol = parts.find((p) => p.type === "currency")?.value ?? "";
    const number = parts
      .filter(
        (p) =>
          p.type === "integer" ||
          p.type === "decimal" ||
          p.type === "fraction" ||
          p.type === "group"
      )
      .map((p) => p.value)
      .join("");
    return { currencySymbol, number };
  } catch {
    return { currencySymbol: "", number: `${amount} ${currency ?? "USD"}` };
  }
}

export function PlanCard({ plan, current = false, loading = false, onSelect }: Props) {
  const remainingTrial = plan.availableTrialDays ?? plan.trialDays;
  // Prefer the shop-effective price (monthlyPrice or plusPrice) when the API
  // provides it, so a Shopify Plus store's card shows its Plus price.
  const { currencySymbol, number } = formatPriceParts(plan.price ?? plan.monthlyPrice, plan.currency);

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e1e3e5",
        borderRadius: 12,
        padding: "20px 20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* Plan name */}
      <Heading level="h3">{plan.name ?? "Plan"}</Heading>

      {/* Price — teal accent on the amount, smaller "/ month" suffix. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 8,
          color: "#0c5132",
        }}
      >
        <span style={{ fontSize: 38, fontWeight: 700, lineHeight: 1 }}>
          {currencySymbol}
          {number}
        </span>
        <span
          style={{
            fontSize: 14,
            color: "#5a5e62",
            fontWeight: 500,
          }}
        >
          / month
        </span>
      </div>

      {/* Trial status — plain caption text, no badge. Hidden on the active
          plan (trial state is irrelevant once the merchant is subscribed). */}
      {!current && plan.trialDays > 0 ? (
        <div style={{ marginTop: 6 }}>
          <Text tone="subdued">
            {remainingTrial > 0
              ? `${remainingTrial} days trial`
              : "Trial used"}
          </Text>
        </div>
      ) : null}

      {/* Activated / CTA row */}
      <div style={{ marginTop: 12 }}>
        {current ? (
          <Badge tone="neutral">Activated</Badge>
        ) : onSelect ? (
          <Button
            variant="primary"
            loading={loading}
            onClick={() => onSelect(plan.id)}
          >
            {`Choose ${plan.name ?? "plan"}`}
          </Button>
        ) : null}
      </div>

      {plan.description ? (
        <div style={{ marginTop: 12 }}>
          <Paragraph>{plan.description}</Paragraph>
        </div>
      ) : null}

      {plan.features.length > 0 ? (
        <>
          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <Divider />
          </div>
          <Stack gap="small-200">
            {plan.features.map((f) => (
              <Stack
                key={f}
                direction="inline"
                gap="small-200"
                alignItems="center"
              >
                <Icon type="check-circle" tone="subdued" />
                <Paragraph>{f}</Paragraph>
              </Stack>
            ))}
          </Stack>
        </>
      ) : null}
    </div>
  );
}

export default PlanCard;
