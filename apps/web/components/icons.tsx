/**
 * The icon set.
 *
 * Inline SVG rather than an icon font or a package. Three reasons, in order of
 * how much they matter here:
 *
 * **`currentColor` is the whole point.** An icon that inherits its colour
 * cannot drift out of step with the text beside it across light mode, dark
 * mode, hover, disabled and focus. An icon font can, and does.
 *
 * **No network, no flash.** These render with the first paint. An icon font
 * arrives late and the interface visibly reflows around it, which is the
 * single most prototype-looking thing a page can do.
 *
 * **Weight matches the type.** Everything here is a 1.5px stroke on a 24-unit
 * grid with round caps, which sits correctly against the interface's text
 * weight. Mixing icon sets is what makes a UI feel assembled rather than
 * designed, so there is one set and it is this one.
 *
 * Every icon is `aria-hidden` by default: an icon beside a label is decorative
 * and announcing it twice is worse than not announcing it. An icon used *as*
 * the only content of a control takes its name from the control's `aria-label`.
 */

import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden focusable="false" {...rest}
    >
      {children}
    </svg>
  );
}

/* --- navigation ---------------------------------------------------------- */

export const IconOverview = (p: IconProps) => (
  <Svg {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></Svg>
);
export const IconSources = (p: IconProps) => (
  <Svg {...p}><path d="M4 4h10l6 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    <path d="M14 4v6h6" /></Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
);
export const IconLiterature = (p: IconProps) => (
  <Svg {...p}><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2Z" />
    <path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2Z" /></Svg>
);
export const IconData = (p: IconProps) => (
  <Svg {...p}><ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></Svg>
);
export const IconDiscover = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" />
    <path d="m15 9-2 4-4 2 2-4Z" /></Svg>
);
export const IconCompare = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v18" /><path d="M5 8H2l3-5 3 5H5Zm0 0v6a3 3 0 0 0 3 3" />
    <path d="M19 8h3l-3-5-3 5h3Zm0 0v6a3 3 0 0 1-3 3" /></Svg>
);
export const IconPatterns = (p: IconProps) => (
  <Svg {...p}><circle cx="6" cy="18" r="2" /><circle cx="12" cy="9" r="2" />
    <circle cx="18" cy="14" r="2" /><path d="m7.6 16.6 3-6M13.4 10.4l3.2 2.4" /></Svg>
);
export const IconConnections = (p: IconProps) => (
  <Svg {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" /><path d="M8.5 6h7M7 8l4 8M17 8l-4 8" /></Svg>
);
export const IconFindings = (p: IconProps) => (
  <Svg {...p}><path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1v.6h6v-.6c0-.4.2-.8.5-1A6 6 0 0 0 12 3Z" /></Svg>
);
export const IconAnalyses = (p: IconProps) => (
  <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
);
export const IconGraph = (p: IconProps) => (
  <Svg {...p}><circle cx="5" cy="8" r="2" /><circle cx="19" cy="7" r="2" />
    <circle cx="12" cy="17" r="2" /><circle cx="12" cy="5" r="2" />
    <path d="M7 8.4 10.2 16M17 8.6 13.8 16M7 7.3l3-1.6M14 5.4l3 1.2" /></Svg>
);
export const IconReports = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" /></Svg>
);
export const IconFigures = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m3 16 5-5 4 4 3-3 6 6" /><circle cx="9" cy="9" r="1.4" /></Svg>
);
export const IconGallery = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <circle cx="17.5" cy="17.5" r="3.5" /></Svg>
);
export const IconNotebook = (p: IconProps) => (
  <Svg {...p}><path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M4 8h3M4 12h3M4 16h3" /></Svg>
);
export const IconSettings = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></Svg>
);

/**
 * A hand, for the two pages that need a camera to be any use.
 *
 * Its own glyph rather than a borrowed one: those pages ask something about
 * this machine — whether it can see your hands — which no other icon in this
 * set says. The gear beside them means settings, and reusing it would put two
 * different questions behind the same picture.
 */
export const IconHand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M11 12V4.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M14 12V6.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M17 13v-1.5a1.5 1.5 0 0 1 3 0V16a5 5 0 0 1-5 5h-2a6 6 0 0 1-6-6v-2l-1.6-1.6a1.5 1.5 0 0 1 2.1-2.1L8 10.5" />
  </Svg>
);

/* --- actions and state --------------------------------------------------- */

export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" /></Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
/** The affordance for "this row opens something", per UI_02's linked objects. */
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
);
/** Provenance: what a thing was computed from. */
export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);
/** A dataset, as distinct from a paper: UI_02 marks the two differently. */
export const IconDataset = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
);
/** A written note, human or model, in the inspector's journal. */
export const IconNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="m5 13 4 4L19 7" /></Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}><path d="M12 9v5M12 17.5v.01" />
    <path d="M10.3 3.9 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Svg>
);
export const IconLogout = (p: IconProps) => (
  <Svg {...p}><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 8 6 12l4 4M6 12h10" /></Svg>
);
export const IconUser = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" /></Svg>
);
export const IconLock = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>
);
export const IconSpark = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8.5 13.2 11l2.5 1-2.5 1L12 15.5 10.8 13l-2.5-1 2.5-1Z" /></Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
