import { useState } from "react";
import { Button } from "../ui";

/**
 * Inline code block with a Copy button. Used on the Installation page for
 * shortcodes / URLs the merchant needs to paste elsewhere.
 */

function toast(content: string, isError = false) {
  (window as any).shopify?.toast?.show?.(content, { isError });
}

type Props = {
  value: string;
  /** Optional adornment rendered to the right of the Copy button, e.g. an
   *  "Open" button that navigates to the URL the code represents. */
  trailing?: React.ReactNode;
};

export function CopyableCode({ value, trailing }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast("Copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copy failed", true);
    }
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#f6f6f7",
        border: "1px solid #e1e3e5",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <code
        style={{
          flex: 1,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </code>
      <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      {trailing}
    </div>
  );
}

export default CopyableCode;
