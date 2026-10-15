import { Badge } from "../ui";

/**
 * Shared status taxonomy. Pages should NOT hand-pick badge tones — pass
 * a domain `status` here so the same concept always renders identically.
 *
 * Add new statuses by extending the StatusKey union + the STATUS_MAP table.
 */

export type StatusKey =
  | "active"
  | "draft"
  | "hidden"
  | "featured"
  | "page-linked"
  | "no-page"
  | "trial"
  | "incomplete"
  | "error";

type StatusDef = {
  label: string;
  tone: "success" | "info" | "warning" | "critical" | "neutral" | "caution";
  icon?: string;
};

const STATUS_MAP: Record<StatusKey, StatusDef> = {
  active: { label: "Active", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
  hidden: { label: "Hidden", tone: "neutral" },
  featured: { label: "Featured", tone: "success", icon: "star-filled" },
  "page-linked": { label: "On page", tone: "info", icon: "page" },
  "no-page": { label: "No page", tone: "neutral", icon: "page" },
  trial: { label: "Trial", tone: "warning" },
  incomplete: { label: "Needs setup", tone: "warning" },
  error: { label: "Error", tone: "critical" },
};

type Props = {
  status: StatusKey;
  /** Override the default label (rare — only when context demands it). */
  label?: string;
};

export function StatusBadge({ status, label }: Props) {
  const def = STATUS_MAP[status];
  return (
    <Badge tone={def.tone} icon={def.icon ?? ""}>
      {label ?? def.label}
    </Badge>
  );
}

export default StatusBadge;
