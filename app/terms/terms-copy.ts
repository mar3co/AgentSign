/**
 * Single source of truth for the terms copy. The HTML page at /terms and the
 * plain-text twin at /terms.txt both render these sections, so the two readers
 * always get the same words. Paragraph breaks inside a body are "\n\n".
 */
export const TERMS_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "Send, sign, fetch",
    body: "AgentSign is a signing primitive: send, sign, fetch. The software is licensed Apache-2.0. You bring the PDF. We do not write it, place fields on it, or claim it is good enough for any particular statute.",
  },
  {
    heading: "Finish and Attest",
    body: "A human finishes. Keys and agents never Finish for a person. Agents may Attest when you name them and allow them.",
  },
  {
    heading: "Plans",
    body: "Free keeps a completed file 7 days. Pro is $19 per month and keeps it a year. Login is identity, not a plan. We may refuse or cap abuse.",
  },
  {
    heading: "Self-host",
    body: "Self-host the same engine if you want it on your own machines. The cloud product is provided as-is.",
  },
];
