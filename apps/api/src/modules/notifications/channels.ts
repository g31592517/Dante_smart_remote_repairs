import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface SendResult {
  provider: string;
  providerMessageId?: string;
}

/** A delivery channel. `configured === false` means deliveries are recorded as SKIPPED, not attempted. */
export interface Channel {
  name: 'EMAIL' | 'SMS' | 'WHATSAPP';
  configured: boolean;
  send(msg: OutboundMessage): Promise<SendResult>;
}

let transporter: Transporter | undefined;
function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

/** Messages captured by the `log` transport — exposed for tests only. */
export const capturedEmails: OutboundMessage[] = [];

export const emailChannel: Channel = {
  name: 'EMAIL',
  configured: env.EMAIL_TRANSPORT === 'log' || !!env.SMTP_HOST,
  async send(msg) {
    if (env.EMAIL_TRANSPORT === 'log') {
      capturedEmails.push(msg);
      if (capturedEmails.length > 200) capturedEmails.shift();
      logger.info({ to: msg.to, subject: msg.subject }, `[email:log] ${msg.subject}\n${msg.text}`);
      return { provider: 'log' };
    }
    const info = await smtp().sendMail({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { provider: 'smtp', providerMessageId: info.messageId };
  },
};

/**
 * SMS and WhatsApp are extension points. No provider SDK is bundled because the business has not chosen
 * one; to enable a channel, implement `send` for the chosen provider here and set the *_PROVIDER env
 * variables (see docs/06_INTEGRATIONS.md). Until then deliveries are recorded as SKIPPED.
 */
function unconfiguredChannel(name: 'SMS' | 'WHATSAPP', provider: string | undefined): Channel {
  return {
    name,
    configured: false,
    async send() {
      throw new Error(`${name} provider "${provider ?? 'none'}" is not implemented`);
    },
  };
}
export const smsChannel = unconfiguredChannel('SMS', env.SMS_PROVIDER);
export const whatsappChannel = unconfiguredChannel('WHATSAPP', env.WHATSAPP_PROVIDER);
