import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config';
import { ProviderError } from '../../errors/domain-errors';
import {
  NotificationPort,
  type NotificationReceipt,
  type NotificationRequest,
} from '../ports';

const INTERAKT_MESSAGE_URL = 'https://api.interakt.ai/v1/public/message/';

/**
 * Phone OTP through Interakt's WhatsApp template API.
 *
 * SMS and WHATSAPP channels both land here when a code is present — Trugrade
 * only sends OTP to Indian mobiles, and Interakt delivers those as WhatsApp
 * authentication templates, not DLT SMS.
 */
@Injectable()
export class InteraktNotification extends NotificationPort {
  private readonly logger = new Logger(InteraktNotification.name);
  private readonly apiKey: string;
  private readonly otpTemplate: string;

  constructor(
    config: AppConfig,
    private readonly fallback: NotificationPort,
  ) {
    super();
    this.apiKey = unquote(config.get('INTERAKT_API_KEY'));
    this.otpTemplate = config.get('INTERAKT_OTP_TEMPLATE');
  }

  async send(req: NotificationRequest): Promise<NotificationReceipt> {
    if (!this.isPhoneOtp(req)) {
      return this.fallback.send(req);
    }

    const code = req.variables.code;
    if (!code) {
      return this.fallback.send(req);
    }

    const { countryCode, phoneNumber } = parseIndianMobile(req.to);
    const languageCode = req.locale === 'hi' ? 'hi' : 'en';

    const payload = {
      countryCode,
      phoneNumber,
      type: 'Template',
      template: {
        name: this.otpTemplate,
        languageCode,
        bodyValues: [code],
        buttonValues: { '0': [code] },
      },
    };

    let response: Response;
    try {
      response = await fetch(INTERAKT_MESSAGE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.error(`Interakt network error: ${(err as Error).message}`);
      throw new ProviderError('interakt', { templateCode: req.templateCode });
    }

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      this.logger.error(
        `Interakt rejected ${this.otpTemplate} -> ${req.to}: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ProviderError('interakt', { templateCode: req.templateCode, status: response.status });
    }

    const id =
      (typeof body.id === 'string' && body.id) ||
      (typeof body.messageId === 'string' && body.messageId) ||
      `interakt-${Date.now()}`;

    this.logger.log(`${this.otpTemplate} -> ${countryCode}${phoneNumber}`);
    return { providerMessageId: id, accepted: true };
  }

  private isPhoneOtp(req: NotificationRequest): boolean {
    return (req.channel === 'SMS' || req.channel === 'WHATSAPP') && Boolean(req.variables.code);
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

function parseIndianMobile(e164: string): { countryCode: string; phoneNumber: string } {
  if (!/^\+91[6-9]\d{9}$/.test(e164)) {
    throw new ProviderError('interakt', {
      reason: 'WhatsApp OTP is only supported for Indian mobile numbers in +91XXXXXXXXXX form.',
    });
  }
  return { countryCode: '+91', phoneNumber: e164.slice(3) };
}
