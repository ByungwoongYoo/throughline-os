/**
 * Whatever the machine can do, the entrance shows something.
 *
 * The sky is a ray-marched black hole, which is a lot to ask of a browser: some
 * have no WebGL2 at all, some lose the context when the GPU suspends, and some
 * readers have asked their system for no motion. Each of those is a different
 * fallback, and every one of them has to end in a picture — the first screen of
 * a product going blank because a shader would not compile is the worst
 * possible first impression, and it is also the one nobody would see in
 * development.
 *
 * happy-dom hands back `null` for both canvas contexts, so the no-WebGL2 case
 * is what the suite gets for free; the others are staged.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Sky } from "@/components/Sky";
import { createSky } from "@/lib/sky/sky";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/**
 * The smallest object `initGL` accepts, counting the draws it is asked for.
 *
 * A real WebGL2 context cannot exist here, and a shallower stub would not do:
 * `initGL` refuses a context whose shaders fail to compile or whose program
 * fails to link, so a stub that answered `undefined` to those would take the
 * fallback path and this file would be testing the wrong branch.
 */
function fakeGL() {
  const state = { draws: 0 };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 1, COMPILE_STATUS: 1, LINK_STATUS: 1,
    ARRAY_BUFFER: 1, STATIC_DRAW: 1, FLOAT: 1, TRIANGLES: 1,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: () => true, useProgram: () => {},
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    getUniformLocation: (name: string) => name,
    uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {},
    viewport: () => {}, getExtension: () => null,
    drawArrays: () => { state.draws += 1; },
  };
  return { gl, state };
}

/** Answer `webgl2` with the stub and `2d` with nothing, as happy-dom does. */
function withGL() {
  const { gl, state } = fakeGL();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((kind: string) => (kind === "webgl2" ? gl : null) as never);
  return state;
}

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

describe("when the browser has no WebGL2", () => {
  it("shows the still rather than an empty rectangle", () => {
    const host = mount();
    const sky = createSky(host);

    const stage = host.querySelector<HTMLElement>(".sky-stage");
    expect(stage).not.toBeNull();
    expect(stage!.dataset.skyGl).toBe("still");
    expect(stage!.style.backgroundImage).toContain("sky-still.jpg");
    expect(sky.drawing).toBe(false);

    sky.destroy();
  });

  it("is what the gate gets in this DOM, without throwing on the way", () => {
    /**
     * The path a component test takes. `TLLayers` asks for a 2D context in its
     * constructor and uses it on the next line, so a DOM that refuses one would
     * throw out of the effect and take every gate and first-project test with
     * it — which is why `createSky` checks before constructing.
     */
    const { container } = render(<Sky variant="gate" />);
    expect(container.querySelector(".sky-stage")?.getAttribute("data-sky-gl"))
      .toBe("still");
    expect(container.querySelectorAll("canvas[aria-hidden=true]")).toHaveLength(2);
  });
});

describe("when the context is lost", () => {
  it("falls back to the still and stops claiming to draw", () => {
    withGL();
    const host = mount();
    const sky = createSky(host);

    const stage = host.querySelector<HTMLElement>(".sky-stage")!;
    expect(stage.dataset.skyGl).toBe("on");

    const canvas = stage.querySelector("canvas.tl-gl")!;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

    expect(stage.dataset.skyGl).toBe("still");
    expect(stage.style.backgroundImage).toContain("sky-still.jpg");
    expect(sky.drawing).toBe(false);

    sky.destroy();
  });
});

describe("when the reader has asked for reduced motion", () => {
  it("paints the composition once and schedules nothing", () => {
    const state = withGL();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const host = mount();

    const sky = createSky(host, { reduced: true });

    expect(state.draws).toBe(1);
    expect(raf).not.toHaveBeenCalled();

    sky.destroy();
  });

  it("still shows the still when there is nothing to draw with", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const host = mount();

    const sky = createSky(host, { reduced: true });

    expect(host.querySelector<HTMLElement>(".sky-stage")!.dataset.skyGl).toBe("still");
    expect(raf).not.toHaveBeenCalled();

    sky.destroy();
  });
});
