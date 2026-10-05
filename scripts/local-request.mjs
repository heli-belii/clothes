// Protect local photos and mutations from other sites, including image embeds.
export function isLocalRequest(req) {
  const address = req.socket?.remoteAddress;
  if (address && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return false;
  const headers = req.headers || {};
  if (headers["sec-fetch-site"] && !["same-origin", "none"].includes(headers["sec-fetch-site"])) return false;
  if (headers.origin) {
    try { if (new URL(headers.origin).host !== headers.host) return false; }
    catch { return false; }
  }
  return true;
}
