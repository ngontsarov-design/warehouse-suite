import * as React from "react";

export function Switch({
  checked,
  onCheckedChange,
  id,
}: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; }) {
  return (
    <button
      id={id}
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={[
        "inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-blue-600" : "bg-gray-300"
      ].join(" ")}
      aria-pressed={checked}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1"
        ].join(" ")}
      />
    </button>
  );
}
