"use client";

/**
 * The ring behind the entrance.
 *
 * A thin mount, like `Sky.tsx`: server-rendered this is one empty div, because
 * a canvas in the markup is a hydration mismatch waiting to happen and nothing
 * in it means anything until there is a context to draw with. Until then the
 * div's own ground is the page colour, so the entrance is never a white
 * rectangle on a slow machine.
 *
 * It hands the caller the renderer's handle rather than driving anything
 * itself. The page owns scroll progress; this owns pixels.
 */

import { useEffect, useRef } from "react";

import { createRing, type RingHandle } from "@/lib/entrance/ring";

export function Scene({ onReady }: { onReady?: (ring: RingHandle) => void }) {
  const container = useRef<HTMLDivElement | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const ring = createRing(element, { still: "/sky-still.jpg" });
    ready.current?.(ring);
    return () => ring.destroy();
  }, []);

  return <div ref={container} className="ring" aria-hidden="true" />;
}
