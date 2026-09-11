"use client";

/**
 * The sky behind the entrance.
 *
 * Server-rendered this is one empty div — the canvases are made in the effect,
 * because a canvas in the markup is a hydration mismatch waiting to happen and
 * because nothing in it means anything until there is a context to draw with.
 * Until then the div's own ground is the page colour, so the entrance is never
 * a white rectangle.
 *
 * Everything else lives in `lib/sky`: the site's two modules, copied, and the
 * driving loop. `sky.ts` rather than `index.ts` because
 * `tests/nothing-is-built-and-unreachable.test.ts` matches an import specifier
 * against a file path and does not resolve a directory to its index — so an
 * index here would read as a module nothing imports, which is the opposite of
 * what that guard is for.
 */

import { useEffect, useRef } from "react";

import { createSky, type SkyVariant } from "@/lib/sky/sky";

export function Sky({ variant }: { variant: SkyVariant }) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const sky = createSky(element);
    return () => sky.destroy();
  }, []);

  return <div ref={container} className="sky" data-sky={variant} aria-hidden="true" />;
}
