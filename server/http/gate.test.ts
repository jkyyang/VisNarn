/** The Vercel gate: the password lets a request through; anything else is asked for it. */
import { afterEach, describe, expect, it, vi } from "vitest";
import gate from "./gate.ts";

const request = (authorization?: string) => new Request("https://example.vercel.app/api/shops", { headers: authorization ? { authorization } : {} });
const basic = (userAndPassword: string) => `Basic ${Buffer.from(userAndPassword).toString("base64")}`;
const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";

afterEach(() => vi.unstubAllEnvs());

describe("gate", () => {
  it("lets in a request with the password under any user name, and asks every other for it", () => {
    vi.stubEnv("VISNARN_PASSWORD", "EXAMPLE pass:word");
    expect(passes(gate(request(basic("anyone:EXAMPLE pass:word"))))).toBe(true);
    expect(passes(gate(request(basic(":EXAMPLE pass:word"))))).toBe(true);
    for (const wrong of [undefined, basic("anyone:wrong"), basic("EXAMPLE pass:word"), "Bearer EXAMPLE pass:word", "Basic"]) {
      const answer = gate(request(wrong));
      expect(answer.status, wrong).toBe(401);
      expect(answer.headers.get("www-authenticate")).toMatch(/^Basic realm=/);
    }
  });

  it("lets nothing through while VISNARN_PASSWORD is unset", () => {
    vi.stubEnv("VISNARN_PASSWORD", "");
    expect(gate(request(basic("anyone:")))).toMatchObject({ status: 503 });
  });
});
