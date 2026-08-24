"use client";

/**
 * What the camera sees, while the researcher needs to see it.
 *
 * §19 is mostly a restraint: the video must not permanently occupy the screen,
 * because the research visualization is the thing being looked at and a webcam
 * feed of one's own face is a distraction at best. So this is shown during
 * setup, where "is my hand in frame, and does the system agree" is the only
 * question that matters, and hidden afterwards behind a status line.
 *
 * The skeleton is the part that earns its place. A raw video preview answers
 * "am I in shot"; the overlaid landmarks answer "does the tracker agree with
 * what I think my hand is doing", which is the question behind every complaint
 * this feature will ever receive. When a pinch is not registering, seeing the
 * thumb landmark stuck to the palm explains it instantly, and no amount of
 * status text does.
 *
 * **Nothing here goes through React state.** Frames arrive about thirty times a
 * second; a `useState` per frame would re-render the workspace at tracker rate,
 * which is the exact cost the session was rewritten to remove. The latest frame
 * is written into a ref by the session and read here on an animation frame, so
 * the canvas repaints and the React tree does not.
 */

import { useEffect, useRef } from "react";
import { HandFrame, Landmark } from "@/lib/spatial/types";

/**
 * MediaPipe's hand topology, as the bones a person would recognise.
 *
 * Drawn as five fingers plus the knuckle ridge rather than 21 unconnected dots:
 * dots alone are hard to read as a hand, and the whole point is that a
 * researcher can tell at a glance whether the tracker has understood them.
 */
const BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],             // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],             // index
  [0, 9], [9, 10], [10, 11], [11, 12],        // middle
  [0, 13], [13, 14], [14, 15], [15, 16],      // ring
  [0, 17], [17, 18], [18, 19], [19, 20],      // pinky
  [5, 9], [9, 13], [13, 17],                  // knuckle ridge
];

export function HandPreview({
  videoRef, frameRef, showSkeleton = true, width = 240, height = 180,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Written by the session at tracker rate; read here on an animation frame. */
  frameRef: React.RefObject<HandFrame | null>;
  showSkeleton?: boolean;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let animation = 0;

    const draw = () => {
      animation = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== width * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Mirrored, because an unmirrored preview is disorienting: moving your
      // hand right moves the hand on screen left, and every correction you make
      // is backwards. Webcam software mirrors self-view for this reason.
      context.save();
      context.translate(width, 0);
      context.scale(-1, 1);

      if (video.videoWidth) {
        context.drawImage(video, 0, 0, width, height);
      }

      const frame = frameRef.current;
      if (showSkeleton && frame) {
        for (const hand of frame.hands) {
          // The landmark order here has to match MediaPipe's, because BONES
          // indexes into it. Reconstructed from the named points this product
          // keeps, with the ones it does not use interpolated for drawing only.
          const points = skeletonPoints(hand);
          drawHand(context, points, width, height);
        }
      }

      context.restore();
    };

    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [videoRef, frameRef, showSkeleton, width, height]);

  return (
    <canvas ref={canvasRef} className="spatial-preview"
            style={{ width, height }}
            role="img"
            aria-label="Camera preview with detected hand position" />
  );
}

/**
 * The 21 points to draw, from the eight this product actually keeps.
 *
 * A compromise worth naming. `Hand` deliberately carries only the landmarks the
 * gestures are defined on — carrying all 21 would invite gesture code to reach
 * for whichever one happened to be convenient, and the small vocabulary is the
 * point. But a skeleton drawn from eight points looks like a spider rather than
 * a hand, and the preview's whole job is legibility.
 *
 * So the intermediate joints are interpolated along each finger. The result is
 * an honest picture of where the tracker believes the fingertips and knuckles
 * are, with straight fingers between them — which is exactly the information
 * this preview exists to convey, and no more.
 */
function skeletonPoints(hand: {
  wrist: Landmark; thumbTip: Landmark; indexTip: Landmark; middleTip: Landmark;
  ringTip: Landmark; pinkyTip: Landmark; indexBase: Landmark; palmCenter: Landmark;
}): Landmark[] {
  const between = (a: Landmark, b: Landmark, t: number): Landmark =>
    ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  const { wrist, palmCenter } = hand;
  // Knuckles: the index knuckle is known; the rest are placed across the palm.
  const indexMcp = hand.indexBase;
  const middleMcp = between(palmCenter, hand.middleTip, 0.25);
  const ringMcp = between(palmCenter, hand.ringTip, 0.25);
  const pinkyMcp = between(palmCenter, hand.pinkyTip, 0.25);

  const finger = (mcp: Landmark, tip: Landmark) =>
    [mcp, between(mcp, tip, 0.4), between(mcp, tip, 0.72), tip];

  return [
    wrist,
    ...finger(between(wrist, hand.thumbTip, 0.25), hand.thumbTip),
    ...finger(indexMcp, hand.indexTip),
    ...finger(middleMcp, hand.middleTip),
    ...finger(ringMcp, hand.ringTip),
    ...finger(pinkyMcp, hand.pinkyTip),
  ];
}

function drawHand(context: CanvasRenderingContext2D, points: Landmark[],
                  width: number, height: number): void {
  const at = (point: Landmark) => ({ x: point.x * width, y: point.y * height });

  context.strokeStyle = "rgba(20, 67, 184, 0.85)";
  context.lineWidth = 2;
  for (const [from, to] of BONES) {
    if (!points[from] || !points[to]) continue;
    const a = at(points[from]);
    const b = at(points[to]);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }

  context.fillStyle = "#1443B8";
  for (const point of points) {
    if (!point) continue;
    const { x, y } = at(point);
    context.beginPath();
    context.arc(x, y, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}
