import * as React from "react";
import { cn } from "./cn";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-gray-700", className)} {...props} />;
}
