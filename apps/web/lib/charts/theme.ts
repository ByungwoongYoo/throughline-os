/**
 * Which page a canvas is being drawn on.
 *
 * SVG charts read CSS variables and follow the theme for free. A canvas
 * cannot: it is painted with literal colours, so every canvas chart has to
 * ask, and has to keep asking — a reader who switches theme with a figure on
 * screen would otherwise keep the palette built for the other background.
 *
 * The precedence is the part worth stating. An explicit `data-theme` stamp is
 * the reader's own choice and wins; the system preference answers only when
 * there is no stamp. Reversed, a researcher who deliberately chose light on a
 * dark machine would be overruled by their operating system, which is exactly
 * the complaint a theme toggle exists to answer.
 */

export function isDarkPage(
  stamp: string | null,
  systemPrefersDark: boolean,
): boolean {
  if (stamp === "dark") return true;
  if (stamp === "light") return false;
  // Any other value is not a choice — an empty attribute, a typo, a value
  // from a future theme this build does not know — so the system decides
  // rather than the string being guessed at.
  return systemPrefersDark;
}
