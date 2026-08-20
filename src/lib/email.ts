import { absoluteUrl, appOrigin, getEnv } from "../env.js";

export type MailAttachment = {
  filename: string;
  bytes: Uint8Array;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
};

export type Mailer = {
  sendMail: (message: MailMessage) => Promise<void>;
};

const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

const recorded: MailMessage[] = [];

/** Test/dev stub; production uses createMailer() when RESEND_API_KEY is set. */
export const stubMailer: Mailer = {
  async sendMail(message) {
    recorded.push(message);
  },
};

export function recordedMail(): MailMessage[] {
  return recorded;
}

/** Log-only when no Resend key; Resend SDK when RESEND_API_KEY is set. */
export function createMailer(): Mailer {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    return {
      async sendMail(message) {
        console.log(
          "[mail]",
          message.to,
          message.subject,
          message.text.slice(0, 120),
          message.attachments?.map((a) => a.filename) ?? [],
        );
      },
    };
  }
  return {
    async sendMail(message) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.bytes).toString("base64"),
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend send failed: ${res.status} ${body}`);
      }
    },
  };
}

export function otpEmail(digits: string): Pick<MailMessage, "subject" | "text"> {
  return {
    subject: "Your Sign verification code",
    text: `Your verification code is ${digits}. It expires in 10 minutes.`,
  };
}

export function inviteEmail(input: {
  signUrl: string;
  senderEmail: string;
  title: string;
  expiresAt: Date;
}): Pick<MailMessage, "subject" | "text"> {
  return {
    subject: `Please sign: ${input.title}`,
    text: [
      `${input.senderEmail} asked you to sign "${input.title}".`,
      ``,
      `Sign here: ${absoluteUrl(input.signUrl)}`,
      ``,
      `This link expires on ${input.expiresAt.toISOString()}.`,
      ``,
      `If you were not expecting this, contact the sender.`,
    ].join("\n"),
  };
}

/** Nudge only — never include a new /s/ token; the original invite URL stays valid. */
export function reminderEmail(input: {
  senderEmail: string;
  title: string;
  expiresAt: Date;
}): Pick<MailMessage, "subject" | "text"> {
  return {
    subject: `Reminder: please sign "${input.title}"`,
    text: [
      `${input.senderEmail} asked you to sign "${input.title}".`,
      ``,
      `Use the unique signing link we already sent you.`,
      ``,
      `This link expires on ${input.expiresAt.toISOString()}.`,
      ``,
      `This request is from ${appOrigin()}/.`,
    ].join("\n"),
  };
}

export function sendLiveEmail(input: {
  title: string;
  tmpKeyShownInResponse: boolean;
  tmpKey?: string;
}): Pick<MailMessage, "subject" | "text"> {
  const lines = [
    `Your send "${input.title}" is live. Signers have been invited in order.`,
  ];
  if (!input.tmpKeyShownInResponse && input.tmpKey) {
    lines.push(``, `Your temporary API key (shown once): ${input.tmpKey}`);
  }
  return {
    subject: `Your send is live: ${input.title}`,
    text: lines.join("\n"),
  };
}

export function completionEmail(input: {
  to: string;
  title: string;
  shredAt: Date;
  includeAttachments: boolean;
}): { subject: string; text: string } {
  const shred = input.shredAt.toISOString();
  const login = absoluteUrl(
    `/login?email=${encodeURIComponent(input.to)}&next=/envelopes`,
  );
  const lines = [
    `"${input.title}" is complete.`,
    ``,
    `Download this. We delete it on ${shred}.`,
  ];
  if (!input.includeAttachments) {
    lines.push(
      ``,
      `Attachments were too large to email (over 10MB combined). Download from your cabinet.`,
    );
  }
  lines.push(
    ``,
    `Keep it in a cabinet: ${login}`,
    ``,
    `Keep this a year: ${absoluteUrl("/upgrade")}`,
  );
  return {
    subject: `Signed: ${input.title}`,
    text: lines.join("\n"),
  };
}

export function completionAttachments(
  sealed: Uint8Array,
  certificate: Uint8Array,
): MailAttachment[] | undefined {
  if (sealed.byteLength + certificate.byteLength > ATTACH_MAX_BYTES) {
    return undefined;
  }
  return [
    { filename: "signed.pdf", bytes: sealed },
    { filename: "certificate.pdf", bytes: certificate },
  ];
}
