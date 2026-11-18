/**
 * Two-letter initials for a member avatar.
 *
 *   "Kendrew Shum" → "KS"   (first letter of the first and last words)
 *   "Rae"          → "RA"   (first two letters of a single word)
 *   "  "           → "?"
 */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const letters = (word: string) => Array.from(word);

  if (words.length === 1) {
    return letters(words[0]).slice(0, 2).join("").toUpperCase();
  }

  const first = letters(words[0])[0];
  const last = letters(words[words.length - 1])[0];
  return `${first}${last}`.toUpperCase();
}
