import * as React from "react";
import { cn } from "./cn";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md";
};

export function Button({ className, variant="default", size="md", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<string,string> = {
    default: "bg-blue-600 text-white hover:bg-blue-700 border-blue-600",
    secondary: "bg-white text-gray-800 hover:bg-gray-50 border-gray-300",
    ghost: "bg-transparent text-gray-700 hover:bg-gray-100 border-transparent",
    destructive: "bg-red-600 text-white hover:bg-red-700 border-red-600",
  };
  const sizes: Record<string,string> = {
    sm: "h-8 px-3",
    md: "h-9 px-3.5",
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
