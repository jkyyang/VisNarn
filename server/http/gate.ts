/**
 * Vercel Routing Middleware (vercel.json "proxy"): every request, page and API, needs the password in
 * VISNARN_PASSWORD, which the browser asks for (HTTP Basic auth, any user name). Without the variable
 * nothing gets through. A laptop never runs this file: it answers 127.0.0.1 only.
 * Vercel builds this file on its own, so it imports no other file of the repo.
 */
import { next } from "@vercel/functions";

export default function gate(request: Request): Response {
  const password = process.env.VISNARN_PASSWORD;
  if (!password) return new Response("Set VISNARN_PASSWORD in the Vercel project.", { status: 503 });
  if (passwordOf(request.headers.get("authorization")) === password) return next();
  return new Response("Password needed.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Shop Arrival Check", charset="UTF-8"' } });
}

/** The password of an "Authorization: Basic <base64 of user:password>" header, or null. */
function passwordOf(header: string | null): string | null {
  const [scheme, encoded] = header?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : null;
}
