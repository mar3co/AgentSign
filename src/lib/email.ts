import { absoluteUrl, appOrigin, devOffline, getEnv } from "../env.js";

export type MailAttachment = {
  filename: string;
  bytes: Uint8Array;
  contentId?: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
};

export type MailBrand = {
  displayName: string | null;
  hasLogo?: boolean;
};

export function brandLogoAttachment(bytes: Uint8Array): MailAttachment {
  return { filename: "logo.png", bytes, contentId: "brand-logo" };
}

export function brandMailAttachments(
  logoBytes?: Uint8Array,
): MailAttachment[] | undefined {
  if (!logoBytes) return undefined;
  return [brandLogoAttachment(logoBytes)];
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlFromText(text: string, hasLogo?: boolean): string {
  const blocks = text.split(/\n{2,}/).map(
    (block) => `<p>${escapeHtml(block).replaceAll("\n", "<br />")}</p>`,
  );
  if (hasLogo) {
    return `<p><img src="cid:brand-logo" alt="" /></p>${blocks.join("")}`;
  }
  return blocks.join("");
}

function senderWho(senderEmail: string, brand?: MailBrand): string {
  return brand?.displayName
    ? `${brand.displayName} (${senderEmail})`
    : senderEmail;
}

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
        console.log("[mail]", message.to, message.subject);
        // DEV_OFFLINE has no inbox at all, so the console IS the inbox: print
        // the body or the OTP confirm step is a dead end. Only there — plain
        // keyless dev must keep codes and signing URLs out of the log.
        if (devOffline()) {
          console.log("[mail:body]", message.text);
        }
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
          ...(message.html ? { html: message.html } : {}),
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.bytes).toString("base64"),
            ...(a.contentId ? { content_id: a.contentId } : {}),
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
    subject: "Your AgentSign verification code",
    text: `Your verification code is ${digits}. It expires in 10 minutes.`,
  };
}

export function inviteEmail(input: {
  signUrl: string;
  senderEmail: string;
  title: string;
  expiresAt: Date;
  brand?: MailBrand;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const text = [
    `${senderWho(input.senderEmail, input.brand)} asked you to sign "${input.title}".`,
    ``,
    `Sign here: ${absoluteUrl(input.signUrl)}`,
    ``,
    `This link expires on ${input.expiresAt.toISOString()}.`,
    ``,
    `If you were not expecting this, contact the sender.`,
  ].join("\n");
  return {
    subject: `Please sign: ${input.title}`,
    text,
    html: htmlFromText(text, input.brand?.hasLogo),
  };
}

/** Nudge only — never remint; reprint the same /s/ URL when `signUrl` is known. */
export function reminderEmail(input: {
  senderEmail: string;
  title: string;
  expiresAt: Date;
  brand?: MailBrand;
  signUrl?: string;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const linkLine = input.signUrl
    ? `Sign here: ${absoluteUrl(input.signUrl)}`
    : `Use the unique signing link we already sent you.`;
  const text = [
    `${senderWho(input.senderEmail, input.brand)} asked you to sign "${input.title}".`,
    ``,
    linkLine,
    ``,
    `This link expires on ${input.expiresAt.toISOString()}.`,
    ``,
    `This request is from ${appOrigin()}/.`,
  ].join("\n");
  return {
    subject: `Reminder: please sign "${input.title}"`,
    text,
    html: htmlFromText(text, input.brand?.hasLogo),
  };
}

export function sendLiveEmail(input: {
  title: string;
  tmpKeyShownInResponse: boolean;
  tmpKey?: string;
  senderEmail?: string;
  brand?: MailBrand;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const lines = [
    `Your send "${input.title}" is live. Signers have been invited in order.`,
  ];
  if (input.brand?.displayName && input.senderEmail) {
    lines.unshift(`${senderWho(input.senderEmail, input.brand)}`, ``);
  }
  if (!input.tmpKeyShownInResponse && input.tmpKey) {
    lines.push(``, `Your temporary API key (shown once): ${input.tmpKey}`);
  }
  const text = lines.join("\n");
  return {
    subject: `Your send is live: ${input.title}`,
    text,
    html: htmlFromText(text, input.brand?.hasLogo),
  };
}

export function completionEmail(input: {
  to: string;
  title: string;
  shredAt: Date;
  includeAttachments: boolean;
  senderEmail?: string;
  brand?: MailBrand;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const shred = input.shredAt.toISOString();
  const login = absoluteUrl(
    `/login?email=${encodeURIComponent(input.to)}&next=/documents`,
  );
  const lines = [
    `"${input.title}" is complete.`,
    ``,
    `Download this. We delete it on ${shred}.`,
  ];
  if (input.brand?.displayName && input.senderEmail) {
    lines.unshift(`${senderWho(input.senderEmail, input.brand)}`, ``);
  }
  if (!input.includeAttachments) {
    lines.push(
      ``,
      `Attachments were too large to email (over 10MB combined). Download from your documents.`,
    );
  }
  lines.push(
    ``,
    `Keep it in your documents: ${login}`,
    ``,
    `Keep this a year: ${absoluteUrl("/upgrade")}`,
  );
  const text = lines.join("\n");
  return {
    subject: `Signed: ${input.title}`,
    text,
    html: htmlFromText(text, input.brand?.hasLogo),
  };
}

export function teamInviteEmail(input: {
  acceptUrl: string;
}): Pick<MailMessage, "subject" | "text"> {
  return {
    subject: "Join your team on AgentSign",
    text: [
      "You were invited to join a team on AgentSign.",
      "",
      `Accept here: ${absoluteUrl(input.acceptUrl)}`,
      "",
      "This invite expires in 7 days.",
    ].join("\n"),
  };
}

export function declineEmail(input: {
  signerName: string;
  title: string;
  reason?: string;
  senderEmail?: string;
  brand?: MailBrand;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const lines = [
    input.reason
      ? `${input.signerName} declined to sign "${input.title}". Reason: ${input.reason}`
      : `${input.signerName} declined to sign "${input.title}".`,
  ];
  if (input.brand?.displayName && input.senderEmail) {
    lines.unshift(`${senderWho(input.senderEmail, input.brand)}`, ``);
  }
  const text = lines.join("\n");
  return {
    subject: `${input.signerName} declined to sign ${input.title}`,
    text,
    html: htmlFromText(text, input.brand?.hasLogo),
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
