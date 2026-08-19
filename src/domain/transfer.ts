/** 個別ファイルのアップロード・スキャン状態(ダウンロード可否はtransfer_groups側で管理する)。 */
export type TransferStatus = 'pending_upload' | 'scanning' | 'clean' | 'infected';

export interface Transfer {
  id: string;
  groupId: string | null;
  senderEmail: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  storageObject: string;
  status: TransferStatus;
  uploadedAt: Date | null;
  scannedAt: Date | null;
  createdAt: Date;
}

/** 送信(1回のフォーム送信=1〜複数ファイル)。ダウンロードURL・OTP認証・期限・DL回数はここに一本化する。 */
export interface TransferGroup {
  id: string;
  senderEmail: string;
  senderName: string | null;
  recipientEmail: string;
  recipientNote: string | null;
  tokenHash: string;
  expiresAt: Date;
  maxDownloads: number;
  downloadCount: number;
  revokedAt: Date | null;
  notifiedAt: Date | null;
  createdAt: Date;
}

export interface DownloadOtp {
  id: string;
  groupId: string;
  codeHash: string;
  expiresAt: Date;
  attemptCount: number;
  verifiedAt: Date | null;
  createdAt: Date;
}

export type AuditEvent =
  | 'created'
  | 'uploaded'
  | 'scan_clean'
  | 'scan_infected'
  | 'otp_requested'
  | 'otp_failed'
  | 'otp_verified'
  | 'downloaded'
  | 'expired'
  | 'revoked';
