export function cn(...a: (string | undefined | false | null)[]) {
  return a.filter(Boolean).join(" ");
}
