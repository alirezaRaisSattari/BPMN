import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

export interface HttpResponse {
  status: number;
  text: string;
}

/** GET JSON via Node's core https module (see postJson for why not fetch). */
export function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 30000,
): Promise<HttpResponse> {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const doRequest = isHttps ? httpsRequest : httpRequest;
  return new Promise<HttpResponse>((resolve, reject) => {
    const req = doRequest(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.end();
  });
}

/**
 * POST JSON using Node's core http(s) module. We deliberately avoid `fetch`
 * (undici): some constrained/proxied environments reset undici's TLS sockets
 * while the core http stack connects fine. Server-side only.
 */
export function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 60000,
): Promise<HttpResponse> {
  const payload = Buffer.from(JSON.stringify(body));
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const doRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise<HttpResponse>((resolve, reject) => {
    const req = doRequest(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    req.write(payload);
    req.end();
  });
}
