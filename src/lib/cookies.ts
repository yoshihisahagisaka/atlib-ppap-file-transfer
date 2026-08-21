import type { Request, Response } from 'express';

/** Express標準のcookie-parser等に頼らない最小限のCookie解析(このスパイクでしか使わないため)。 */
export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function setCookie(
  res: Response,
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; secure: boolean },
): void {
  res.cookie(name, value, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax', // IdPからのトップレベルGETリダイレクトではLaxでもCookieが送られる
    maxAge: opts.maxAgeSeconds * 1000,
    path: '/',
  });
}

export function clearCookie(res: Response, name: string): void {
  res.clearCookie(name, { path: '/' });
}
