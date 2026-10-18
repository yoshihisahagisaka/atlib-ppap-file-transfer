import { requireValue, integer } from '../domain/commercialUsage';
import type { Reservation } from '../domain/commercialUsage';

/** Narrow SDK port. Production passes the existing private bucket, never a client-supplied bucket. */
export interface CommercialBucket {
  file(name: string): {
    getSignedUrl(options: { version: 'v4'; action: 'write'; expires: number; contentType: string; extensionHeaders: Record<string, string> }): Promise<[string]>;
    getMetadata(): Promise<[ { size?: string | number; generation?: string | number } ]>;
    delete(options: { ifGenerationMatch: string; ignoreNotFound: boolean }): Promise<unknown>;
  };
}
export class CommercialGcs {
  private bucket: CommercialBucket;
  constructor(bucket: CommercialBucket) { this.bucket = bucket; }
  async uploadGrant(r: Reservation, contentType: string, now: number) {
    requireValue(r.state === 'reserved' && now < r.expiresAt, 'RESERVATION_NOT_ACTIVE');
    integer(r.bytes, 'SIZE', 1);
    requireValue(contentType.length > 0 && contentType.length <= 255 && !/[\r\n]/.test(contentType), 'INVALID_CONTENT_TYPE');
    const headers = { 'x-goog-content-length-range': `${r.bytes},${r.bytes}`, 'x-goog-if-generation-match': '0' };
    const [url] = await this.bucket.file(r.objectName).getSignedUrl({ version: 'v4', action: 'write', expires: r.expiresAt,
      contentType, extensionHeaders: headers });
    return { url, method: 'PUT' as const, headers: { ...headers, 'Content-Type': contentType }, expiresAt: r.expiresAt };
  }
  async metadata(name: string): Promise<{ sizeBytes: number; generation: string } | null> {
    try {
      const [m] = await this.bucket.file(name).getMetadata();
      const sizeBytes = integer(Number(m.size), 'ACTUAL_SIZE', 1);
      // Preserve generation as a decimal string; it is not a JS numeric identifier.
      requireValue(typeof m.generation === 'string' && /^[0-9]+$/.test(m.generation), 'INVALID_GENERATION');
      return { sizeBytes, generation: m.generation };
    } catch (e) { if ((e as { code?: number }).code === 404) return null; throw e; }
  }
  async deleteGeneration(name: string, generation: string): Promise<void> {
    requireValue(/^[0-9]+$/.test(generation), 'INVALID_GENERATION');
    // A 412 MUST propagate: another generation must not be removed.
    await this.bucket.file(name).delete({ ifGenerationMatch: generation, ignoreNotFound: true });
  }
}
