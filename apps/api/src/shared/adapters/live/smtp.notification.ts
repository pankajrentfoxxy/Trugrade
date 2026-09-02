import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../../config';
import { ProviderError } from '../../errors/domain-errors';
import {
  NotificationPort,
  type NotificationReceipt,
  type NotificationRequest,
} from '../ports';

/**
 * Sends EMAIL through SMTP (Nodemailer). SMS / WhatsApp / push stay on the
 * fallback — those are a different hop and this adapter is only the mailbox.
 *
 * Wired when `SMTP_USER` is set and `NODE_ENV` is not `test`, so a developer's
 * Gmail credentials cannot fire from the integration suite.
 */
@Injectable()
export class SmtpNotification extends NotificationPort {
  private readonly logger = new Logger(SmtpNotification.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(
    config: AppConfig,
    private readonly fallback: NotificationPort,
  ) {
    super();
    const user = unquote(config.get('SMTP_USER'));
    const pass = unquote(config.get('SMTP_PASS'));
    this.from = unquote(config.get('SMTP_FROM')) || user;
    this.transport = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      secure: config.get('SMTP_SECURE'),
      auth: user ? { user, pass } : undefined,
    });
  }

  async send(req: NotificationRequest): Promise<NotificationReceipt> {
    if (req.channel !== 'EMAIL') {
      return this.fallback.send(req);
    }

    const { subject, text, html } = renderEmail(req);
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: req.to,
        subject,
        text,
        html,
      });
      const id = typeof info.messageId === 'string' ? info.messageId : `smtp-${Date.now()}`;
      this.logger.log(`${req.templateCode} -> ${req.to}`);
      return { providerMessageId: id, accepted: true };
    } catch (err) {
      this.logger.error(`SMTP failed for ${req.templateCode}: ${(err as Error).message}`);
      throw new ProviderError('smtp', { templateCode: req.templateCode });
    }
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const OTP_SUBJECTS: Record<string, string> = {
  AUTH_REGISTER_OTP: 'Your Trugrade registration code',
  AUTH_LOGIN_OTP: 'Your Trugrade sign-in code',
  AUTH_PASSWORD_RESET: 'Reset your Trugrade password',
  AUTH_CONTACT_CHANGE_OTP_OLD: 'Confirm a contact change on Trugrade',
  AUTH_CONTACT_CHANGE_OTP_NEW: 'Verify your new email on Trugrade',
};

function renderEmail(req: NotificationRequest): { subject: string; text: string; html: string } {
  const code = req.variables.code;
  const minutes = req.variables.minutes ?? '10';
  const isOtp = Boolean(code) && (req.templateCode.includes('OTP') || req.templateCode in OTP_SUBJECTS);

  if (isOtp && code) {
    const subject = OTP_SUBJECTS[req.templateCode] ?? 'Your Trugrade verification code';
    const text = `Your Trugrade code is ${code}. It expires in ${minutes} minutes. Do not share it with anyone.`;
    const html = `<p>Your Trugrade code is <strong style="font-family:ui-monospace,monospace;letter-spacing:0.12em">${escapeHtml(code)}</strong>.</p><p>It expires in ${escapeHtml(minutes)} minutes. Do not share it with anyone.</p>`;
    return { subject, text, html };
  }

  const subject = subjectFor(req.templateCode);
  const lines = Object.entries(req.variables)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const text = lines || 'A notice from Trugrade.';
  const html = `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>`;
  return { subject, text, html };
}

function subjectFor(templateCode: string): string {
  if (templateCode.includes('PASSWORD_RESET')) return 'Reset your Trugrade password';
  if (templateCode.includes('CONTACT_CHANGE')) return 'Your Trugrade contact details changed';
  if (templateCode.includes('BANK')) return 'A bank-account change on Trugrade';
  return 'A notice from Trugrade';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
