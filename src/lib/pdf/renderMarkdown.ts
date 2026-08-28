import { Lexer, Tokenizer, marked, type Token, type Tokens } from "marked";
import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const [PAGE_W, PAGE_H] = PageSizes.Letter;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_SIZE = 11;
const CODE_SIZE = 9.5;
const LEADING = 1.4;
const HEADING_SIZES = [22, 17, 14, 12.5, 11.5, 11] as const;
const INDENT_STEP = 20;
const TAG_RE = /\{\{[^}]+\}\}/g;
const RULE_GRAY = rgb(0.6, 0.6, 0.6);
const FOOTER_SIZE = 9;
const MAX_PAGES = 200;
const MAX_INDENT = CONTENT_W / 2;
const LEX_BUDGET_MS = 5_000;

export class MarkdownTooLargeError extends Error {
  code = "markdown_too_large" as const;
  constructor(message = "Rendered markdown exceeds the page limit") {
    super(message);
    this.name = "MarkdownTooLargeError";
  }
}

export class EmptyMarkdownError extends Error {
  code = "invalid_markdown" as const;
  constructor(message = "Markdown contains no renderable text") {
    super(message);
    this.name = "EmptyMarkdownError";
  }
}

/**
 * Lex with a wall-clock budget: marked is superlinear on adversarial input,
 * so a deadline check in every tokenizer step keeps untrusted markdown from
 * pinning the CPU. Deep nesting overflows the stack inside marked; both cases
 * surface as MarkdownTooLargeError (the input, not us, is at fault).
 */
function lexWithBudget(src: string, budgetMs: number): Token[] {
  const deadline = Date.now() + budgetMs;
  const tokenizer = new Tokenizer();
  const proto = Tokenizer.prototype as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const fn = proto[name];
    if (name === "constructor" || typeof fn !== "function") continue;
    (tokenizer as unknown as Record<string, unknown>)[name] = function (
      this: unknown,
      ...args: unknown[]
    ) {
      if (Date.now() > deadline) {
        throw new MarkdownTooLargeError("Markdown is too complex to render");
      }
      return (fn as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
  try {
    return new Lexer({ ...marked.defaults, tokenizer }).lex(src);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new MarkdownTooLargeError("Markdown is nested too deeply");
    }
    throw err;
  }
}

/** cp1252 graphic characters above 0xFF that WinAnsi can encode. */
const CP1252_EXTRAS = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ",
);

/** Drop characters WinAnsi (StandardFonts) cannot encode; keep layout whitespace. */
function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\n" || ch === "\t") {
      out += ch === "\t" ? "  " : ch;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += ch;
    else if (CP1252_EXTRAS.has(ch)) out += ch;
  }
  return out;
}

type Style = "regular" | "bold" | "italic" | "bolditalic" | "code";

/** A run of same-style text. Atomic runs ({{tags}}) are drawn as one op, never split or merged. */
type Run = { text: string; style: Style; atomic?: boolean };

type Fonts = Record<Style, PDFFont> & { heading: PDFFont };

type Piece = { text: string; font: PDFFont; atomic?: boolean };

function mergeStyle(base: Style, add: "bold" | "italic"): Style {
  if (base === "code") return base;
  if (add === "bold") return base === "italic" || base === "bolditalic" ? "bolditalic" : "bold";
  return base === "bold" || base === "bolditalic" ? "bolditalic" : "italic";
}

/** Flatten marked inline tokens into styled runs. Never throws on odd input. */
function inlineRuns(tokens: Token[] | undefined, style: Style = "regular"): Run[] {
  const runs: Run[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
        runs.push(...inlineRuns(token.tokens, mergeStyle(style, "bold")));
        break;
      case "em":
        runs.push(...inlineRuns(token.tokens, mergeStyle(style, "italic")));
        break;
      case "del":
        runs.push(...inlineRuns(token.tokens, style));
        break;
      case "codespan":
        runs.push({ text: (token as Tokens.Codespan).text, style: "code" });
        break;
      case "link": {
        const link = token as Tokens.Link;
        const inner = inlineRuns(link.tokens, style);
        runs.push(...inner);
        const label = inner.map((r) => r.text).join("");
        if (link.href && link.href !== label) {
          runs.push({ text: ` (${link.href})`, style });
        }
        break;
      }
      case "image":
        runs.push({ text: `[image: ${(token as Tokens.Image).text || "untitled"}]`, style });
        break;
      case "br":
        runs.push({ text: "\n", style });
        break;
      case "escape":
        runs.push({ text: (token as Tokens.Escape).text, style });
        break;
      case "html":
        runs.push({ text: (token as Tokens.HTML | Tokens.Tag).raw, style });
        break;
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) runs.push(...inlineRuns(t.tokens, style));
        else runs.push({ text: t.text, style });
        break;
      }
      default:
        if ("raw" in token) runs.push({ text: String(token.raw), style });
        break;
    }
  }
  return splitTags(runs);
}

/** Make each {{tag}} its own atomic run so it lands in a single text op. */
function splitTags(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.atomic || run.style === "code") {
      out.push(run);
      continue;
    }
    let last = 0;
    for (const m of run.text.matchAll(TAG_RE)) {
      if (m.index > last) out.push({ text: run.text.slice(last, m.index), style: run.style });
      out.push({ text: m[0], style: run.style, atomic: true });
      last = m.index + m[0].length;
    }
    if (last < run.text.length) out.push({ text: run.text.slice(last), style: run.style });
  }
  return out;
}

/** HTML entities marked leaves in text tokens. */
function unescapeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function plainText(tokens: Token[] | undefined): string {
  return inlineRuns(tokens)
    .map((r) => r.text)
    .join("");
}

/**
 * Word-wrap styled runs into lines of drawable pieces. Preserves inter-run
 * spacing, honors explicit "\n" breaks, and keeps atomic pieces intact.
 */
function wrapRuns(
  runs: Run[],
  maxWidth: number,
  size: number,
  fontFor: (style: Style) => PDFFont,
  fontOverride?: PDFFont,
): Piece[][] {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let lineWidth = 0;
  let pendingSpace = false;

  const flush = () => {
    if (line.length > 0) lines.push(line);
    line = [];
    lineWidth = 0;
    pendingSpace = false;
  };

  const append = (word: string, font: PDFFont, atomic: boolean) => {
    let prefix = pendingSpace && line.length > 0 ? " " : "";
    pendingSpace = false;
    let width = font.widthOfTextAtSize(prefix + word, size);
    if (line.length > 0 && lineWidth + width > maxWidth) {
      flush();
      prefix = "";
      width = font.widthOfTextAtSize(word, size);
    }
    const last = line[line.length - 1];
    if (last && last.font === font && !atomic && !last.atomic) {
      last.text += prefix + word;
    } else {
      if (prefix && last && last.font === font && !last.atomic) last.text += prefix;
      else if (prefix) line.push({ text: prefix, font });
      line.push({ text: word, font, atomic });
    }
    lineWidth += width;
  };

  // Char-level split for a single word wider than the wrap width, so long
  // hashes and unspaced URLs stay on the paper instead of running off it.
  const breakWord = (word: string, font: PDFFont): string[] => {
    const chunks: string[] = [];
    let current = "";
    let currentWidth = 0;
    for (const ch of word) {
      const w = font.widthOfTextAtSize(ch, size);
      if (current && currentWidth + w > maxWidth) {
        chunks.push(current);
        current = ch;
        currentWidth = w;
      } else {
        current += ch;
        currentWidth += w;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  };

  for (const run of runs) {
    const font = fontOverride ?? fontFor(run.style);
    const text = toWinAnsi(unescapeEntities(run.text));
    if (run.atomic) {
      append(text, font, true);
      continue;
    }
    for (const segment of text.split(/(\s+)/)) {
      if (segment.length === 0) continue;
      if (/^\s+$/.test(segment)) {
        if (segment.includes("\n")) flush();
        else pendingSpace = true;
        continue;
      }
      if (font.widthOfTextAtSize(segment, size) > maxWidth) {
        for (const chunk of breakWord(segment, font)) append(chunk, font, false);
      } else {
        append(segment, font, false);
      }
    }
  }
  flush();
  return lines;
}

class Typesetter {
  private page: PDFPage;
  private y: number;
  private drawnGlyphs = 0;

  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    private maxPages: number,
  ) {
    this.page = doc.addPage(PageSizes.Letter);
    this.y = PAGE_H - MARGIN;
  }

  private fontFor = (style: Style): PDFFont => this.fonts[style];

  /** Non-whitespace characters actually drawn; zero means a blank document. */
  get glyphCount(): number {
    return this.drawnGlyphs;
  }

  private ensureRoom(lineHeight: number): void {
    if (this.y - lineHeight >= MARGIN) return;
    if (this.doc.getPageCount() >= this.maxPages) throw new MarkdownTooLargeError();
    this.page = this.doc.addPage(PageSizes.Letter);
    this.y = PAGE_H - MARGIN;
  }

  gap(points: number): void {
    this.y -= points;
  }

  rule(indent = 0): void {
    indent = Math.min(indent, MAX_INDENT);
    this.ensureRoom(BODY_SIZE);
    this.y -= BODY_SIZE;
    this.page.drawLine({
      start: { x: MARGIN + indent, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE_GRAY,
    });
  }

  drawRuns(runs: Run[], opts: { size?: number; indent?: number; font?: PDFFont } = {}): void {
    const size = opts.size ?? BODY_SIZE;
    // Clamp so deep list/quote nesting keeps a usable wrap width on-page.
    const indent = Math.min(opts.indent ?? 0, MAX_INDENT);
    const lines = wrapRuns(runs, CONTENT_W - indent, size, this.fontFor, opts.font);
    for (const pieces of lines) {
      const lineHeight = size * LEADING;
      this.ensureRoom(lineHeight);
      this.y -= lineHeight;
      let x = MARGIN + indent;
      for (const piece of pieces) {
        this.page.drawText(piece.text, { x, y: this.y, size, font: piece.font });
        this.drawnGlyphs += piece.text.replace(/\s/g, "").length;
        x += piece.font.widthOfTextAtSize(piece.text, size);
      }
    }
  }

  drawCode(text: string): void {
    const font = this.fonts.code;
    const charW = font.widthOfTextAtSize("M", CODE_SIZE);
    const maxChars = Math.max(8, Math.floor(CONTENT_W / charW));
    this.gap(CODE_SIZE * 0.5);
    for (const raw of toWinAnsi(text).split("\n")) {
      const chunks = raw.length === 0 ? [""] : raw.match(new RegExp(`.{1,${maxChars}}`, "g"))!;
      for (const chunk of chunks) {
        const lineHeight = CODE_SIZE * LEADING;
        this.ensureRoom(lineHeight);
        this.y -= lineHeight;
        if (chunk.length > 0) {
          this.page.drawText(chunk, { x: MARGIN, y: this.y, size: CODE_SIZE, font });
          this.drawnGlyphs += chunk.replace(/\s/g, "").length;
        }
      }
    }
    this.gap(CODE_SIZE * 0.5);
  }

  drawTable(token: Tokens.Table): void {
    const cols = token.header.length;
    if (cols === 0) return;
    const colW = CONTENT_W / cols;
    const cellW = colW - 8;
    const lineHeight = BODY_SIZE * LEADING;

    const rowLines = (cells: Tokens.TableCell[], header: boolean): Piece[][][] =>
      cells.map((cell) => {
        const runs = header
          ? inlineRuns(cell.tokens).map((r) => ({ ...r, style: mergeStyle(r.style, "bold") }))
          : inlineRuns(cell.tokens);
        return wrapRuns(runs, cellW, BODY_SIZE, this.fontFor);
      });

    // Rows paginate per wrapped line so a tall cell continues on the next
    // page instead of drawing below the bottom margin.
    const drawRow = (cells: Tokens.TableCell[], header: boolean) => {
      const perCell = rowLines(cells, header);
      const rows = Math.max(1, ...perCell.map((l) => l.length));
      for (let lineIdx = 0; lineIdx < rows; lineIdx++) {
        this.ensureRoom(lineHeight);
        this.y -= lineHeight;
        for (const [col, cellLines] of perCell.entries()) {
          const pieces = cellLines[lineIdx];
          if (!pieces) continue;
          let x = MARGIN + col * colW;
          for (const piece of pieces) {
            this.page.drawText(piece.text, { x, y: this.y, size: BODY_SIZE, font: piece.font });
            this.drawnGlyphs += piece.text.replace(/\s/g, "").length;
            x += piece.font.widthOfTextAtSize(piece.text, BODY_SIZE);
          }
        }
      }
    };

    this.gap(BODY_SIZE * 0.5);
    drawRow(token.header, true);
    this.gap(3);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE_GRAY,
    });
    for (const row of token.rows) {
      this.gap(6);
      drawRow(row, false);
    }
    this.gap(BODY_SIZE * 0.5);
  }

  drawBlocks(tokens: Token[], indent = 0): void {
    for (const token of tokens) {
      switch (token.type) {
        case "space":
          break;
        case "heading": {
          const t = token as Tokens.Heading;
          const size = HEADING_SIZES[Math.min(Math.max(t.depth, 1), 6) - 1]!;
          this.gap(size * 0.7);
          this.drawRuns(splitTags([{ text: plainText(t.tokens), style: "regular" }]), {
            size,
            indent,
            font: this.fonts.heading,
          });
          this.gap(size * 0.35);
          break;
        }
        case "paragraph":
          this.drawRuns(inlineRuns((token as Tokens.Paragraph).tokens), { indent });
          this.gap(BODY_SIZE * 0.6);
          break;
        case "list": {
          const list = token as Tokens.List;
          const start = typeof list.start === "number" ? list.start : 1;
          for (const [i, item] of list.items.entries()) {
            const marker = list.ordered ? `${start + i}.` : "•";
            const inline: Token[] = [];
            const nested: Token[] = [];
            for (const child of item.tokens) {
              if (child.type === "list") nested.push(child);
              else inline.push(child);
            }
            const runs = inline.flatMap((child) =>
              child.type === "text" && (child as Tokens.Text).tokens?.length
                ? inlineRuns((child as Tokens.Text).tokens)
                : inlineRuns([child]),
            );
            this.drawRuns([{ text: `${marker} `, style: "regular" }, ...runs], {
              indent: indent + INDENT_STEP,
            });
            this.gap(BODY_SIZE * 0.25);
            if (nested.length > 0) this.drawBlocks(nested, indent + INDENT_STEP);
          }
          this.gap(BODY_SIZE * 0.35);
          break;
        }
        case "blockquote":
          this.drawBlocks((token as Tokens.Blockquote).tokens, indent + INDENT_STEP);
          break;
        case "code":
          this.drawCode((token as Tokens.Code).text);
          break;
        case "hr":
          this.rule(indent);
          this.gap(BODY_SIZE * 0.6);
          break;
        case "table":
          this.drawTable(token as Tokens.Table);
          break;
        case "html":
          this.drawRuns(splitTags([{ text: (token as Tokens.HTML).raw.trim(), style: "regular" }]), {
            indent,
          });
          this.gap(BODY_SIZE * 0.6);
          break;
        default:
          if ("raw" in token && typeof token.raw === "string" && token.raw.trim()) {
            this.drawRuns(splitTags([{ text: token.raw.trim(), style: "regular" }]), { indent });
            this.gap(BODY_SIZE * 0.6);
          }
          break;
      }
    }
  }
}

export async function renderMarkdown(
  markdown: string,
  opts: { maxPages?: number; lexBudgetMs?: number } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const epoch = new Date(0);
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
  doc.setProducer("AgentSign");
  doc.setCreator("AgentSign");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    bolditalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    code: await doc.embedFont(StandardFonts.Courier),
    heading: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const typesetter = new Typesetter(doc, fonts, opts.maxPages ?? MAX_PAGES);
  typesetter.drawBlocks(lexWithBudget(markdown, opts.lexBudgetMs ?? LEX_BUDGET_MS));
  if (typesetter.glyphCount === 0) throw new EmptyMarkdownError();

  const footerFont = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const [i, page] of pages.entries()) {
    const label = `Page ${i + 1} of ${pages.length}`;
    const width = footerFont.widthOfTextAtSize(label, FOOTER_SIZE);
    page.drawText(label, {
      x: (PAGE_W - width) / 2,
      y: MARGIN / 2,
      size: FOOTER_SIZE,
      font: footerFont,
      color: RULE_GRAY,
    });
  }
  return doc.save();
}
