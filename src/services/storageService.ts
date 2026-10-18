import { Storage } from '@google-cloud/storage';
import { CommercialGcs } from './commercialGcs';

interface GcsErrorLike {
  code?: number;
}

export class StorageService {
  private readonly storage = new Storage();

  constructor(private readonly bucketName: string) {}

  commercial(): CommercialGcs {
    const bucket = this.storage.bucket(this.bucketName);
    return new CommercialGcs({file: name => ({
      getSignedUrl: options => bucket.file(name).getSignedUrl(options),
      getMetadata: async () => { const [metadata] = await bucket.file(name).getMetadata(); return [metadata]; },
      delete: options => bucket.file(name).delete(options),
    })});
  }

  objectPath(transferId: string, filename: string): string {
    return `incoming/${transferId}/${filename}`;
  }

  /**
   * アップロード用の署名付きPUT URL。ブラウザからGCSへ直接アップロードさせることで、
   * Cloud Runのリクエストボディサイズ制限を回避する。
   * 署名生成にはランタイムのサービスアカウントに roles/iam.serviceAccountTokenCreator (自分自身に対して)
   * が必要 — 詳細はdocs/デプロイ手順書を参照。
   */
  async createUploadUrl(objectPath: string, contentType: string): Promise<string> {
    const [url] = await this.storage
      .bucket(this.bucketName)
      .file(objectPath)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType,
      });
    return url;
  }

  async createDownloadUrl(objectPath: string, filename: string, expiresMinutes: number, generation?: string | null, deadline?: number): Promise<string> {
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
    const [url] = await this.storage
      .bucket(this.bucketName)
      .file(objectPath, generation ? { generation } : undefined)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Math.min(Date.now() + expiresMinutes * 60 * 1000, deadline ?? Infinity),
        responseDisposition: `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
    return url;
  }

  async getMetadata(objectPath: string): Promise<{ sizeBytes: number; contentType: string } | null> {
    try {
      const [meta] = await this.storage.bucket(this.bucketName).file(objectPath).getMetadata();
      return {
        sizeBytes: Number(meta.size ?? 0),
        contentType: meta.contentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if ((err as GcsErrorLike)?.code === 404) return null;
      throw err;
    }
  }

  async download(objectPath: string, generation?: string | null): Promise<Buffer> {
    const [buffer] = await this.storage.bucket(this.bucketName).file(objectPath, generation ? { generation } : undefined).download();
    return buffer;
  }

  async delete(objectPath: string, generation?: string | null): Promise<void> {
    await this.storage.bucket(this.bucketName).file(objectPath).delete({ ignoreNotFound: true, ...(generation ? { ifGenerationMatch: generation } : {}) });
  }
}
