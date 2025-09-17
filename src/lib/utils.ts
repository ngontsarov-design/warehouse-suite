// src/lib/utils.ts
import { type ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склеивает className с учётом tailwind-приоритетов */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
