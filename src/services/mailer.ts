import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config';

export class Mailer {
  private readonly transporter: Transporter;
  private readonly fromHeader: string;

  constructor(private readonly config: Config['smtp']) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false, // 587 + STARTTLS
      auth: { user: config.user, pass: config.password },
    });
    // 受信メールボックスの送信者名が "noreply" とだけ表示されるのを避けるため、表示名を付与する。
    this.fromHeader = `"atLIB株式会社" <${config.from}>`;
  }

  /**
   * 同じフォーム送信でアップロードされた複数ファイル(clean判定のもののみ)をまとめて1通・1リンクで
   * 通知する。1ファイルの送信でもこのメソッドを使う(filesが1件のリストになるだけ)。
   * To/CCはSMTPのネイティブなTo/Ccヘッダで同送する(本文は同一)。ダウンロード権限の実際の境界は
   * ここではなくOTP認証側にある — CCは本文のリンクを見えても、Toの受信箱宛にしか
   * OTPコードが送られないため、自分でダウンロードを完了させることはできない。
   */
  async sendGroupDownloadLinkNotice(params: {
    to: string[];
    cc: string[];
    senderEmail: string;
    senderName: string;
    note: string | null;
    expiresAt: Date;
    downloadUrl: string;
    files: Array<{ filename: string }>;
  }): Promise<void> {
    const expiresLabel = params.expiresAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const noteLine = params.note ? `\n添付メッセージ: ${params.note}\n` : '';
    const fileList = params.files.map((f) => `・${f.filename}`).join('\n');
    const subject = `atLIB株式会社 ${params.senderName} より ファイルが届いています`;
    await this.transporter.sendMail({
      from: this.fromHeader,
      to: params.to,
      cc: params.cc.length > 0 ? params.cc : undefined,
      subject,
      text:
        `atLIB株式会社の${params.senderName}(${params.senderEmail})よりファイルが送信されました。\n\n` +
        `有効期限: ${expiresLabel}\n` +
        noteLine +
        `\n【送付ファイル】\n${fileList}\n\n` +
        `以下のリンクからダウンロードしてください(確認コードの入力が必要です。宛先(To)欄に記載の` +
        `ご自身のメールアドレスをダウンロードページで入力すると、その宛先に確認コードが届きます):\n` +
        `${params.downloadUrl}\n\n` +
        `※このメールに心当たりがない場合は破棄してください。返信は受け付けておりません。`,
    });
  }

  async sendOtpCode(to: string, code: string, filename: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromHeader,
      to,
      subject: `【atLIB】ダウンロード確認コード: ${code}`,
      text:
        `ファイル「${filename}」のダウンロード確認コードです。\n\n` +
        `確認コード: ${code}\n\n` +
        `このコードは10分間有効です。ダウンロードページに入力してください。\n` +
        `※心当たりがない場合はこのメールを破棄してください。`,
    });
  }

  async sendInfectedNotice(to: string, filename: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromHeader,
      to,
      subject: `【atLIB】ウイルススキャンでファイルが検出されました(${filename})`,
      text:
        `送信いただいたファイル「${filename}」からウイルス/マルウェアの疑いが検出されたため、\n` +
        `安全のため削除し、受信者への送信をブロックしました。\n\n` +
        `お手数ですが、送信元ファイルをウイルスチェックのうえ再送信をお願いします。\n` +
        `解消しない場合は情報システム担当までご連絡ください。`,
    });
  }

  async sendStaffAlert(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({ from: this.fromHeader, to, subject: `【PPAP回避システム】${subject}`, text: body });
  }

  /** Commercial usage notifier supplies only current tenant admins and a minimal, token-free body. */
  async sendUsageNotice(to: string[], subject: string, text: string): Promise<void> {
    await this.transporter.sendMail({ from: this.fromHeader, to, subject, text });
  }
}
