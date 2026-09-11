/**
 * The gate is mounted and unmounted on every sign-in.
 *
 * A ray marcher left running behind a workspace is not a leak you notice as a
 * leak — it is a laptop fan, a battery, and a page that feels slow for reasons
 * nothing on screen explains. The loop, the listeners and the canvases all have
 * to go when the component does, and the only way to know they did is to check.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Sky } from "@/components/Sky";
import { createSky } from "@/lib/sky/sky";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** As in `sky-never-leaves-the-entrance-blank`: the least `initGL` accepts. */
function withGL() {
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((kind: string) => (kind === "webgl2" ? gl : null) as never);
  return state;
}

describe("unmounting the sky", () => {
  it("cancels the frame it had queued", () => {
    withGL();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const cancel = vi.spyOn(window, "cancelAnimationFrame");

    const { unmount } = render(<Sky variant="first" />);
    expect(raf).toHaveBeenCalled();
    const queued = raf.mock.results.map((result) => result.value as number);

    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(queued).toContain(cancel.mock.calls[0][0]);
  });

  it("takes its listeners and its canvases with it", () => {
    withGL();
    const removed = vi.spyOn(window, "removeEventListener");

    const { container, unmount } = render(<Sky variant="gate" />);
    expect(container.querySelectorAll("canvas")).toHaveLength(2);

    unmount();
    expect(removed).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(container.querySelector(".sky-stage")).toBeNull();
  });

  it("does not let a stale frame restart the loop", () => {
    /**
     * The failure this guards is quiet: a callback that outlived its cancel
     * draws once and then asks for another frame, and from then on a ray
     * marcher is running behind a signed-in workspace with nothing on the page
     * to say so.
     */
    const pending: FrameRequestCallback[] = [];
    const state = withGL();
    vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((fn: FrameRequestCallback) => { pending.push(fn); return 1; });

    const host = document.createElement("div");
    document.body.append(host);
    const sky = createSky(host);
    expect(pending).toHaveLength(1);

    sky.destroy();
    const drawn = state.draws;
    pending[0](0);

    expect(pending).toHaveLength(1);
    expect(state.draws).toBe(drawn);
  });
});
