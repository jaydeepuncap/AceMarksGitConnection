/**
 * Types shared by the components in app/components/Common that come from the
 * common component library (e.g. PlanCard). This app has no billing plans yet;
 * the shape below is what PlanCard reads.
 */
export interface AppPlan {
  id: number;
  name: string;
  description?: string | null;
  /** Shop-effective monthly price (e.g. the Plus price), when the API provides it. */
  price?: number;
  monthlyPrice: number;
  currency: string | null;
  trialDays: number;
  /** Trial days the shop still has, when it already used part of a trial. */
  availableTrialDays?: number | null;
  features: string[];
}
