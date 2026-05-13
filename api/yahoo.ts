import type { VercelRequest, VercelResponse } from "@vercel/node";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).setHeader("Allow", "GET, HEAD").end("Method Not Allowed");
    return;
  }

  const path = String(req.query.path ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!path || path.includes("..")) {
    res.status(400).json({ error: "invalid path" });
    return;
  }

  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (typeof val === "string") qs.append(key, val);
    else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string") qs.append(key, item);
      }
    }
  }
  const q = qs.toString();
  const upstream = `https://query1.finance.yahoo.com/${path}${q ? `?${q}` : ""}`;

  const r = await fetch(upstream, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const ct = r.headers.get("content-type") ?? "application/json";
  res.status(r.status).setHeader("Content-Type", ct);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const body = Buffer.from(await r.arrayBuffer());
  res.send(body);
}
