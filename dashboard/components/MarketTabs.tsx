"use client";

import type { Market } from "@/lib/types";

export const MARKETS: { id: Market; label: string }[] = [
  { id: "tokopedia", label: "Tokopedia" },
  { id: "shopee", label: "Shopee" },
  { id: "lazada", label: "Lazada" },
];

export default function MarketTabs({ value, onChange }: { value: Market; onChange: (m: Market) => void }) {
  return (
    <div className="tabs" role="tablist" aria-label="Marketplace">
      {MARKETS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          id={`tab-${m.id}`}
          aria-selected={value === m.id}
          aria-controls={`panel-${m.id}`}
          className="tab"
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
