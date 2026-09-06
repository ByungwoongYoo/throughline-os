/**
 * What reaches a researcher when the API answers with something unexpected.
 *
 * Found by opening the workspace with no API running. The panel printed its
 * own correct note — "The API is not answering. Start it with
 * ./scripts/dev.sh" — and directly above it, as the failure itself:
 *
 *     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * `request` called `JSON.parse` unguarded, so any body that is not JSON threw
 * a `SyntaxError` past every handler in the product. It sends somebody to
 * debug JSON when nothing is serving the address.
 *
 * The parse also ran *before* the status was read, so a 502 from a proxy or a
 * 500 rendered as an HTML error page threw on the parse and never became an
 * `ApiError` — skipping §104's rule that the server's own words reach the
 * researcher, for exactly the failures where those words matter most.
 *
 * `requestBytes`, ten lines below in the same file, already checked the status
 * first and guarded its parse. This is the same repair, in the function every
 * screen actually uses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";

const answer = (body: string, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response);

afterEach(() => vi.restoreAllMocks());

const HTML = "<!DOCTYPE html><html><body>Not found</body></html>";

describe("a body that is not JSON", () => {
  it("is not reported as a parser error", async () => {
    answer(HTML);

    await expect(api.get("/api/projects")).rejects.toThrow(ApiError);
    await expect(api.get("/api/projects")).rejects.not.toThrow(SyntaxError);
  });

  it("says nothing is serving the API, which is what it means", async () => {
    answer(HTML);

    await expect(api.get("/api/projects")).rejects.toThrow(/nothing is\s+serving the API/);
    // Never the character it choked on.
    await expect(api.get("/api/projects")).rejects.not.toThrow(/Unexpected token/);
  });
});

describe("an error whose body is not JSON", () => {
  it("keeps the status, which the parse used to throw away", async () => {
    /*
     * The direction that matters most: a proxy's 502 and a framework's 500
     * both arrive as HTML, and both used to surface as a `SyntaxError` with
     * no status at all — so every screen that branches on a status saw none.
     */
    answer("<html><body>502 Bad Gateway</body></html>", 502);

    await expect(api.get("/api/projects")).rejects.toMatchObject({ status: 502 });
  });

  it("carries a short plain-text body, which is a gateway saying something",
     async () => {
    answer("upstream connect error", 502);

    await expect(api.get("/api/projects")).rejects.toThrow(/upstream connect error/);
  });

  it("never quotes markup, however short the page", async () => {
    /*
     * My first repair for this got it wrong, and the rendered page said so
     * within a minute: it sliced 300 characters of the body into the message,
     * so the workspace showed `<!DOCTYPE HTML> <html lang="en"> <head> <meta
     * charset="utf-8"> <title>Error response</title>…` where a sentence
     * belongs — less use than the parser error it replaced.
     *
     * The judgement was borrowed from `requestBytes`, whose two endpoints
     * return short plain-text errors. A general client meets whole HTML
     * documents. Borrowing the comment without the circumstances is what made
     * it worse.
     */
    answer("<html><body>404</body></html>", 404);

    await expect(api.get("/api/projects")).rejects.toThrow(/nothing is\s+serving the API/);
    await expect(api.get("/api/projects")).rejects.not.toThrow(/DOCTYPE|<html|<body/);
  });

  it("keeps the status in the sentence, so it is not only in the object",
     async () => {
    answer("<html><body>404</body></html>", 404);

    await expect(api.get("/api/projects")).rejects.toThrow(/HTTP 404/);
  });
});

describe("what already worked, and still does", () => {
  it("gives the server's detail for a JSON error", async () => {
    answer(JSON.stringify({ detail: "No model is configured." }), 409);

    await expect(api.get("/api/x")).rejects.toMatchObject({
      status: 409, message: "No model is configured." });
  });

  it("parses a JSON success", async () => {
    answer(JSON.stringify({ id: "prj_1" }));

    await expect(api.get("/api/x")).resolves.toEqual({ id: "prj_1" });
  });

  it("treats an empty body as nothing, not as a failure", async () => {
    // A 204-shaped answer: no body to parse, and nothing wrong with that.
    answer("");

    await expect(api.get("/api/x")).resolves.toBeNull();
  });
});

describe("a validation error, which FastAPI sends as a list", () => {
  /*
   * Found against the running API. Every hand-raised `HTTPException` carries a
   * string detail, and every *validation* failure carries a list of objects:
   *
   *   {"detail":[{"type":"string_too_short","loc":["body","password"],
   *               "msg":"String should have at least 12 characters", ...}]}
   *
   * `String(detail)` on that is "[object Object]", so the researcher's first
   * action on a new machine — setting it up, and mistyping a password — could
   * report itself as `[object Object]`. §104 says the server's own words reach
   * the researcher; the server's words are in `msg` and the field is in `loc`,
   * and both were being discarded at the last step.
   */
  const validation = (...errors: Array<{ loc: string[]; msg: string }>) =>
    JSON.stringify({ detail: errors.map((e) => ({ type: "x", input: "", ...e })) });

  it("never renders as [object Object]", async () => {
    answer(validation({ loc: ["body", "password"],
                        msg: "String should have at least 12 characters" }), 422);

    await expect(api.post("/api/auth/setup", {})).rejects.not.toThrow(/object Object/);
  });

  it("says which field, and what the server said about it", async () => {
    answer(validation({ loc: ["body", "password"],
                        msg: "String should have at least 12 characters" }), 422);

    await expect(api.post("/api/auth/setup", {}))
      .rejects.toThrow(/password.*at least 12 characters/);
  });

  it("carries every field when more than one is wrong", async () => {
    /*
     * A form with two bad fields that names one teaches the researcher to fix
     * and resubmit twice, which is how a setup screen earns a reputation.
     */
    answer(validation(
      { loc: ["body", "display_name"], msg: "String should have at least 1 character" },
      { loc: ["body", "password"], msg: "String should have at least 12 characters" },
    ), 422);

    const thrown: Error = await api.post("/api/auth/setup", {})
      .then(() => { throw new Error("expected a rejection"); },
            (e: unknown) => e as Error);
    expect(thrown.message).toMatch(/display_name/);
    expect(thrown.message).toMatch(/password/);
  });
});

describe("the shape the running API actually sends", () => {
  /*
   * Captured from a live `POST /api/auth/setup` rather than written here.
   *
   * Six unfaithful fixtures have been found in this repository, every one a
   * value the product cannot produce sitting in a test that looked like
   * coverage of the thing that was broken. The cheapest defence against a
   * seventh is to stop inventing the bytes: this is what FastAPI answered,
   * verbatim, with two fields wrong at once.
   */
  const CAPTURED = '{"detail":[{"type":"string_too_short","loc":["body",'
    + '"display_name"],"msg":"String should have at least 1 character",'
    + '"input":"","ctx":{"min_length":1}},{"type":"string_too_short","loc":'
    + '["body","password"],"msg":"String should have at least 12 characters",'
    + '"input":"short","ctx":{"min_length":12}}]}';

  it("reads as sentences a person can act on", async () => {
    answer(CAPTURED, 422);

    const thrown: Error = await api.post("/api/auth/setup", {})
      .then(() => { throw new Error("expected a rejection"); },
            (e: unknown) => e as Error);

    expect(thrown.message).toBe(
      "display_name: String should have at least 1 character. "
      + "password: String should have at least 12 characters.");
  });
});
