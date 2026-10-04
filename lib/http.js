// Small helpers shared by the API routes.
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const fail = (e, status = 400) => json({ error: e?.message || String(e) }, status);

export function isAdmin(request) {
  const code = request.headers.get("x-admin-code") || "";
  return !!process.env.ADMIN_CODE && code === process.env.ADMIN_CODE;
}
export function isCron(request) {
  const auth = request.headers.get("authorization") || "";
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
}
