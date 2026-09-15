/**
 * The Throughline mark, from the brand file, in one place.
 *
 * It existed twice and neither copy knew about the other. The entrance drew
 * the real thing — a circle with a line passing through it, which is what the
 * name means — and the workspace drew an approximation in CSS: a 15px bordered
 * circle with a rotated `::after` for the line. Both were called `.brand-mark`,
 * so the entrance's SVG inherited the workspace's `border` and
 * `border-radius: 50%` and rendered the line and circle inside a second,
 * larger ellipse. On the product's own front page the mark read as a ball.
 *
 * One component, the brand file's own geometry, sized by its caller. A mark
 * drawn twice is a mark that will differ, and this is the first thing anybody
 * sees.
 */
export function BrandMark({ height = 50, className, strokePx }: {
  /** Drawn to a height; the width follows the mark's own 220:150. */
  height?: number;
  className?: string;
  /**
   * The line's weight in screen pixels, for small sizes.
   *
   * The brand file draws a 1.6-unit line in a 150-unit box, which is right at
   * the size the entrance shows it and a quarter of a pixel at the workspace
   * header's 28px — so the product's own mark rendered as a pale grey smudge
   * beside a wordmark set in full ink. Given in pixels, the weight holds
   * whatever size the mark is drawn at.
   */
  strokePx?: number;
}) {
  const stroke = strokePx != null
    ? { strokeWidth: strokePx, vectorEffect: "non-scaling-stroke" as const }
    : { strokeWidth: 1.6 };
  return (
    <svg
      viewBox="0 0 220 150"
      className={className}
      width={Math.round(height * (220 / 150))}
      height={height}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="110" cy="75" r="46" stroke="currentColor" {...stroke} />
      <line x1="20.7" y1="122.5" x2="199.3" y2="27.5"
            stroke="currentColor" {...stroke} />
    </svg>
  );
}
