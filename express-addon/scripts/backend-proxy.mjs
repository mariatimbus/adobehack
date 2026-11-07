import { request } from "node:http";

/** Mounted at /api/v1 on the Adobe HTTPS dev server. Only this fixed local
 * backend is reachable; callers cannot select an arbitrary upstream host. */
export function backendProxy(req, res) {
  const headers = {};
  for (const name of ["content-type", "accept"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  // Adobe's Express server has already parsed application/json requests.
  const json = req.is("application/json") && req.body !== undefined
    ? Buffer.from(JSON.stringify(req.body)) : undefined;
  if (json) headers["content-length"] = String(json.length);
  else if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];

  const upstream = request({
    hostname: "127.0.0.1", port: 8765,
    path: req.originalUrl, method: req.method, headers,
  }, (response) => {
    res.status(response.statusCode ?? 502);
    if (response.headers["content-type"]) res.setHeader("content-type", response.headers["content-type"]);
    response.on("error", () => res.destroy());
    response.pipe(res);
  });
  upstream.setTimeout(60_000, () => upstream.destroy(new Error("Backend request timed out")));
  upstream.on("error", (error) => {
    if (res.headersSent) { res.destroy(); return; }
    res.status(502).json({
      detail: error.message === "Backend request timed out"
        ? "CreativeDNA backend took too long to respond. Try again."
        : "CreativeDNA backend is unavailable. Start .venv/bin/uvicorn backend.app:app --port 8765 from the creativedna directory.",
    });
  });
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
  if (json) upstream.end(json);
  else req.pipe(upstream); // Multipart uploads keep their original boundary and bytes.
}
