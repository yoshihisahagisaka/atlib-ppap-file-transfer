const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParseEmailListResult {
  emails: string[];
  invalid: string[];
}

/** カンマ区切りのメールアドレス文字列を配列に分解する(前後空白除去・空要素除去・重複除去、大文字小文字は区別)。 */
export function parseEmailList(raw: string): ParseEmailListResult {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    if (!EMAIL_RE.test(part)) {
      invalid.push(part);
      continue;
    }
    if (seen.has(part)) continue;
    seen.add(part);
    emails.push(part);
  }
  return { emails, invalid };
}
