/**
 * Shape from shading: a mark that reads as a sphere rather than a disc.
 *
 * Every three-dimensional chart here draws its marks as flat filled circles.
 * The scene already carries three depth cues — back-to-front compositing,
 * perspective size, and the aerial haze in `lib/charts/depth.ts` — and the one
 * it does not carry is the strongest one the visual system has: shading. A lit
 * sphere is read as solid and located in space before any of the others are
 * consciously processed; a flat disc is read as a sticker.
 *
 * **This is the version of "make it look like a render" that costs nothing in
 * honesty, and it is chosen for that reason.** The obvious alternative is
 * ambient occlusion — darkening marks that are surrounded by others, which is
 * what makes molecular renders read as solid. It is more striking and it is
 * not free: occlusion varies darkness *between* marks according to local
 * density, and a reader who takes darkness for a value is reading a claim
 * nobody made. Shading varies lightness *within* one mark, from a light that
 * is the same for every mark in every chart, so it adds no signal at all. It
 * is decoration in the strict sense — and depth cues are the one kind of
 * decoration a data figure is entitled to, because the reader is being told
 * about the geometry, not about the data.
 *
 * **Sprites, not gradients.** A volume draws twenty-five thousand splats
 * inside a measured thirteen-millisecond budget, and `createRadialGradient`
 * per mark would not fit in it. Each colour is rendered once into a small
 * offscreen canvas and stamped with `drawImage` thereafter. The cache is
 * bounded: a chart colouring marks continuously would otherwise grow one
 * sprite per distinct value until the tab ran out of memory.
 *
 * **The silhouette does not change.** A mark still occupies exactly the circle
 * of the radius it was given, because hit-testing measures distance against
 * that radius — a mark that drew larger than it tests would be a mark the
 * reader can see and cannot point at.
 */

/**
 * Where the light comes from, in units of the mark's radius.
 *
 * Constant for every mark in every chart, which is the whole reason this adds
 * no information: if it varied with position or value, lightness would encode
 * something and the figure would be making a claim. Up and to the left is the
 * convention almost every renderer uses, and the one the eye expects.
 */
export const LIGHT = { x: -0.38, y: -0.42 };

/** The offscreen sprite's size in pixels. */
export const SPRITE_PX = 64;

/**
 * How many colours to keep sprites for.
 *
 * A categorical palette is a handful; a continuous ramp is unbounded, and this
 * is what stops the second case growing without limit.
 */
export const MAX_SPRITES = 64;

const sprites = new Map<string, HTMLCanvasElement | null>();

/** For tests, and for a theme change that invalidates every colour. */
export function forgetSprites(): void {
  sprites.clear();
}

/**
 * A lit sphere of one colour, or null where no canvas can be made.
 *
 * Null is a real answer rather than a failure: the caller falls back to the
 * flat fill that was there before, which is correct and merely plainer.
 */
export function sphereSprite(colour: string): HTMLCanvasElement | null {
  const cached = sprites.get(colour);
  if (cached !== undefined) return cached;

  let sprite: HTMLCanvasElement | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_PX;
    canvas.height = SPRITE_PX;
    const context = canvas.getContext("2d");
    if (context) {
      const r = SPRITE_PX / 2;
      const gradient = context.createRadialGradient(
        r + LIGHT.x * r * 0.55, r + LIGHT.y * r * 0.55, r * 0.05,
        r, r, r);
      // The assigned colour sits at the middle stop, not at an end: it is what
      // the mark is *for*, and a legend entry that matches nothing on the
      // canvas is worse than a flat disc. The ends are the same hue lifted and
      // dropped, so the colour identity survives the shading.
      gradient.addColorStop(0, lighten(colour, 0.45));
      gradient.addColorStop(0.45, colour);
      gradient.addColorStop(1, darken(colour, 0.42));
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(r, r, r, 0, Math.PI * 2);
      context.fill();
      sprite = canvas;
    }
  } catch {
    // A context that throws (an offscreen budget, a headless DOM) is the same
    // answer as one that is absent.
    sprite = null;
  }

  if (sprites.size >= MAX_SPRITES) sprites.clear();
  sprites.set(colour, sprite);
  return sprite;
}

/**
 * Draw one mark as a lit sphere, falling back to the flat fill.
 *
 * Returns whether it was shaded, so a caller can say so in a caption rather
 * than claiming a treatment it did not get.
 */
export function drawLitSphere(
  context: CanvasRenderingContext2D,
  x: number, y: number, radius: number, colour: string,
): boolean {
  const sprite = sphereSprite(colour);
  if (!sprite) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();
    return false;
  }
  // Exactly the circle of the given radius: the silhouette a reader points at
  // is the one hit-testing measures.
  context.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  return true;
}

// --- colour arithmetic -----------------------------------------------------
//
// Only lightness moves. Shifting hue would make one mark a different colour
// from its own legend entry at the edges, which is the failure this is trying
// to avoid rather than cause.

function channels(colour: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const body = hex[1].length === 3
      ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16),
            parseInt(body.slice(4, 6), 16), 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(colour.trim());
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => Number(p.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return [parts[0], parts[1], parts[2],
              parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1];
    }
  }
  return null;
}

function mix(colour: string, towards: number, amount: number): string {
  const parsed = channels(colour);
  // An unparseable colour is returned untouched rather than guessed at: a
  // named colour or a CSS variable still draws, just without the lift.
  if (!parsed) return colour;
  const [r, g, b, a] = parsed;
  const at = (channel: number) =>
    Math.round(channel + (towards - channel) * amount);
  return `rgba(${at(r)},${at(g)},${at(b)},${a})`;
}

export function lighten(colour: string, amount: number): string {
  return mix(colour, 255, amount);
}

export function darken(colour: string, amount: number): string {
  return mix(colour, 0, amount);
}
