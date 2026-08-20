export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  sendMail: (message: MailMessage) => Promise<void>;
};

const recorded: MailMessage[] = [];

/** Test/dev stub; production Resend wiring is later. */
export const stubMailer: Mailer = {
  async sendMail(message) {
    recorded.push(message);
  },
};

export function recordedMail(): MailMessage[] {
  return recorded;
}
