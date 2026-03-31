import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distHtmlPath = path.join(rootDir, "dist", "odoo-inventory-flow.html");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const sessions = new Map();

function formatOdooError(errorPayload, fallback = "Unknown Odoo error.") {
  if (!errorPayload) return fallback;
  if (typeof errorPayload === "string") return errorPayload;

  const message =
    errorPayload?.data?.message ||
    errorPayload?.message ||
    errorPayload?.data?.name ||
    fallback;

  const debugLine = typeof errorPayload?.data?.debug === "string"
    ? errorPayload.data.debug.split("\n").find(line => line.trim())
    : "";

  if (debugLine && debugLine !== message) {
    return `${message} (${debugLine})`;
  }

  return message;
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function extractCookiePairs(setCookieHeaders) {
  const cookies = new Map();
  setCookieHeaders.forEach(header => {
    const match = header.match(/^([^=;,\s]+)=([^;]*)/);
    if (match) {
      cookies.set(match[1], match[2]);
    }
  });
  return cookies;
}

function getSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  let sessionId = cookies.proxy_session_id;

  if (!sessionId) {
    sessionId = randomUUID();
    res.setHeader("Set-Cookie", serializeCookie("proxy_session_id", sessionId, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }));
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { odooCookies: new Map() });
  }

  return sessions.get(sessionId);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function handleProxy(req, res) {
  const session = getSession(req, res);
  const { targetUrl, path: targetPath, params } = await readRequestBody(req);

  if (typeof targetUrl !== "string" || !/^https?:\/\//.test(targetUrl)) {
    return sendJson(res, 400, { error: "targetUrl must be an absolute http(s) URL." });
  }

  if (typeof targetPath !== "string" || !targetPath.startsWith("/")) {
    return sendJson(res, 400, { error: "path must start with '/'." });
  }

  const normalizedTargetUrl = targetUrl.replace(/\/+$/, "");
  const targetOrigin = new URL(normalizedTargetUrl).origin;
  const cookieJar = session.odooCookies.get(targetOrigin) || new Map();
  const cookieHeader = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");

  console.log(`[proxy] POST ${targetPath} -> ${targetOrigin}`);

  const upstream = await fetch(`${normalizedTargetUrl}${targetPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params,
    }),
  });

  extractCookiePairs(getSetCookieHeaders(upstream.headers)).forEach((value, name) => {
    cookieJar.set(name, value);
  });
  session.odooCookies.set(targetOrigin, cookieJar);

  const text = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(text || "{}");
  } catch {
    console.error(`[proxy] Non-JSON response from ${targetPath}: ${text.slice(0, 500)}`);
    return sendJson(res, 502, { error: "Odoo returned a non-JSON response.", details: text.slice(0, 500) });
  }

  if (payload?.error) {
    console.error(`[proxy] Odoo error for ${targetPath}: ${formatOdooError(payload.error)}`);
    if (typeof payload?.error?.data?.debug === "string") {
      console.error(payload.error.data.debug.split("\n").slice(0, 8).join("\n"));
    }
  }

  res.writeHead(upstream.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function handleHtml(req, res) {
  const html = await readFile(distHtmlPath, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(html);
}

const server = createServer(async (req, res) => {
  try {
    if ((req.method === "GET" || req.method === "HEAD") && (req.url === "/" || req.url === "/odoo-inventory-flow.html")) {
      await handleHtml(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/odoo-proxy") {
      await handleProxy(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected proxy error.";
    console.error(`[proxy] Unexpected error: ${message}`);
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`Odoo proxy server running at http://${host}:${port}`);
});
