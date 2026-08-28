import { describe, expect, it } from "vitest";
import {
  MarkdownTooLargeError,
  renderMarkdown,
} from "../lib/pdf/renderMarkdown.js";
import { parsePdfTags } from "../lib/pdf/tags.js";
import { pdfPagesText, pdfTextItems } from "./pdf.js";

describe("renderMarkdown", () => {
  it("renders headings and paragraphs onto a Letter page", async () => {
    const pdf = await renderMarkdown(
      "# Service Agreement\n\nThis agreement is made between the parties.",
    );
    const pages = await pdfPagesText(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Service Agreement");
    expect(pages[0]).toContain("This agreement is made between the parties.");
  });

  it("draws bold and italic runs in distinct fonts", async () => {
    const pdf = await renderMarkdown("The buyer **must** review the *entire* deed.");
    const items = await pdfTextItems(pdf);
    const regular = items.find((i) => i.str.includes("The buyer"));
    const bold = items.find((i) => i.str.includes("must"));
    const italic = items.find((i) => i.str.includes("entire"));
    expect(regular && bold && italic).toBeTruthy();
    expect(bold!.fontName).not.toBe(regular!.fontName);
    expect(italic!.fontName).not.toBe(regular!.fontName);
    expect(italic!.fontName).not.toBe(bold!.fontName);
  });

  it("renders bullet and ordered list markers", async () => {
    const pdf = await renderMarkdown("- apples\n- pears\n\n1. first\n2. second");
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("apples");
    expect(text).toContain("pears");
    expect(text).toContain("1.");
    expect(text).toContain("second");
  });

  it("indents nested list items further than their parents", async () => {
    const pdf = await renderMarkdown("- parent\n  - child");
    const items = await pdfTextItems(pdf);
    const parent = items.find((i) => i.str.includes("parent"));
    const child = items.find((i) => i.str.includes("child"));
    expect(parent && child).toBeTruthy();
    expect(child!.x).toBeGreaterThan(parent!.x);
  });

  it("indents blockquotes", async () => {
    const pdf = await renderMarkdown("above\n\n> quoted terms\n\nbelow");
    const items = await pdfTextItems(pdf);
    const plain = items.find((i) => i.str.includes("above"));
    const quoted = items.find((i) => i.str.includes("quoted terms"));
    expect(plain && quoted).toBeTruthy();
    expect(quoted!.x).toBeGreaterThan(plain!.x);
  });

  it("renders fenced code in a monospace font, verbatim lines", async () => {
    const pdf = await renderMarkdown("body text\n\n```\nline one\nline two\n```");
    const items = await pdfTextItems(pdf);
    const body = items.find((i) => i.str.includes("body text"));
    const code = items.find((i) => i.str.includes("line"));
    expect(body && code).toBeTruthy();
    expect(code!.fontName).not.toBe(body!.fontName);
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("line one");
    expect(text).toContain("line two");
  });

  it("renders table cell text", async () => {
    const pdf = await renderMarkdown(
      "| Item | Price |\n| --- | --- |\n| Filing fee | $40 |",
    );
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("Item");
    expect(text).toContain("Filing fee");
    expect(text).toContain("$40");
  });

  it("degrades raw HTML to literal text", async () => {
    const pdf = await renderMarkdown("<div>hello there</div>");
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("hello there");
  });

  it("degrades images to an alt placeholder", async () => {
    const pdf = await renderMarkdown("![company logo](https://x.test/logo.png)");
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("[image: company logo]");
    expect(text).not.toContain("https://x.test/logo.png");
  });

  it("paginates long content and numbers every page", async () => {
    const md = Array.from({ length: 120 }, (_, i) => `Clause ${i + 1} text.`).join("\n\n");
    const pdf = await renderMarkdown(md);
    const pages = await pdfPagesText(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain(`Page 1 of ${pages.length}`);
    expect(pages[pages.length - 1]).toContain(
      `Page ${pages.length} of ${pages.length}`,
    );
  });

  it("throws MarkdownTooLargeError past the page cap", async () => {
    const md = Array.from({ length: 200 }, (_, i) => `Clause ${i + 1} text.`).join("\n\n");
    await expect(renderMarkdown(md, { maxPages: 2 })).rejects.toBeInstanceOf(
      MarkdownTooLargeError,
    );
  });

  it("renders identical bytes for identical input", async () => {
    const md = "# Deed\n\nSigned by **both** parties.\n\n- one\n- two";
    const a = await renderMarkdown(md);
    const b = await renderMarkdown(md);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("degrades characters outside WinAnsi instead of throwing", async () => {
    const pdf = await renderMarkdown("I agree 🤝 to the 完全 terms — fully.");
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("I agree");
    expect(text).toContain("terms — fully.");
  });

  it("round-trips {{sig}} tags through the tag parser, including whiteout", async () => {
    const pdf = await renderMarkdown(
      "# Agreement\n\nSign below to accept.\n\n{{sig}}\n\n{{Full Name;type=text;role=Signer 1}}",
    );
    const parsed = await parsePdfTags(pdf);
    const names = parsed.fields.map((f) => f.name).sort();
    expect(names).toEqual(["Full Name", "sig"]);
    expect(parsed.fields.find((f) => f.name === "sig")?.type).toBe("signature");
    const again = await parsePdfTags(parsed.pdf);
    expect(again.fields).toEqual([]);
  });

  it("renders links as text plus URL", async () => {
    const pdf = await renderMarkdown("See [our site](https://example.com) for details.");
    const text = (await pdfPagesText(pdf))[0]!;
    expect(text).toContain("our site");
    expect(text).toContain("(https://example.com)");
  });
});
