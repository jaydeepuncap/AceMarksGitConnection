import type { ComponentType, ReactNode } from "react";

declare const EmptyData: ComponentType<{
  title?: string;
  children?: ReactNode;
  image?: string;
}>;

export default EmptyData;
