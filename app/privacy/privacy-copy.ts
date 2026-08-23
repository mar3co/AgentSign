/**
 * Single source of truth for the privacy copy. The HTML page at /privacy and
 * the plain-text twin at /privacy.txt both render these sections, so the two
 * readers always get the same words. Paragraph breaks inside a body are "\n\n".
 */
export const PRIVACY_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "What we keep",
    body: [
      "You send us a PDF, a sender email, and signer names and emails. We store the file, hashes of signing tokens, and an audit log of send, consent, finish, attest, and shred.",
      "Mail goes through our provider. Payments go through Stripe. Auth and storage sit on Supabase when you run the cloud product.",
    ].join("\n\n"),
  },
  {
    heading: "What we shred",
    body: "Free completed documents are shredded 7 days after they finish. If nobody signs, we shred when the link dies. Pro keeps them a year. Hard delete means the bytes go; the audit row stays as a tombstone.",
  },
  {
    heading: "What we don't do",
    body: "Signers do not need an account. Login is optional, after finish, if you want to keep your documents. We do not sell your documents. We do not draft your legal language.",
  },
];
