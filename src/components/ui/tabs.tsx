import * as React from "react";
import { cn } from "./cn";

export function Tabs({
  tabs, value, onChange, className
}: { tabs: {key:string; label:string; icon?: React.ReactNode}[]; value: string; onChange:(k:string)=>void; className?:string; }) {
  return (
    <div className={cn("flex gap-2", className)}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm",
            value===t.key ? "bg-white border-gray-200 shadow-sm" : "bg-gray-100 border-transparent hover:bg-gray-200"
          )}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}
