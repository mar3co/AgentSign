import { existsSync } from "node:fs";

/**
 * DOCX uploads: detect, then convert to PDF (mammoth HTML + headless
 * Chromium print) so everything downstream stays a plain PDF pipeline.
 * Text content — including {{tags}} — survives conversion.
 */

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class DocxUnavailableError extends Error {
  code = "docx_unavailable" as const;
}
export class DocxConvertError extends Error {
  code = "invalid_docx" as const;
}

/** DOCX files are zip containers (PK\x03\x04) — pair the magic with mime/name. */
export function isDocx(bytes: Uint8Array, type: string, name: string): boolean {
  const zipMagic =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  if (!zipMagic) return false;
  return type === DOCX_MIME || /\.docx$/i.test(name);
}

/** Legacy binary .doc (OLE compound file) — unsupported, but worth naming. */
export function isLegacyDoc(bytes: Uint8Array, type: string, name: string): boolean {
  const oleMagic =
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;
  return oleMagic && (type === "application/msword" || /\.doc$/i.test(name));
}

const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function chromiumExecutable(): Promise<{
  executablePath: string;
  args: string[];
  headless: boolean | "shell";
}> {
  let bundledError: unknown;
  if (process.platform === "linux") {
    try {
      const chromium = (await import("@sparticuz/chromium")).default;
      // The bundled binary is a headless-shell build; "shell" is the mode
      // @sparticuz/chromium documents, not puppeteer's default.
      return {
        executablePath: await chromium.executablePath(),
        args: chromium.args,
        headless: "shell",
      };
    } catch (err) {
      bundledError = err; // Fall through to system paths.
    }
  }
  const local = LOCAL_CHROME_PATHS.find((p) => existsSync(p));
  if (!local) {
    const e = new DocxUnavailableError("no chromium executable found");
    e.cause = bundledError;
    throw e;
  }
  return { executablePath: local, args: [], headless: true };
}

function pageHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 12pt; line-height: 1.4; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #999; padding: 4px 6px; }
    img { max-width: 100%; }
  </style></head><body>${body}</body></html>`;
}

export async function docxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  let html: string;
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({
      buffer: Buffer.from(bytes),
    });
    html = result.value;
  } catch (err) {
    const e = new DocxConvertError("could not read DOCX");
    e.cause = err;
    throw e;
  }

  const { executablePath, args, headless } = await chromiumExecutable();
  let browser;
  try {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath,
      args,
      headless,
    });
  } catch (err) {
    // A present-but-broken Chromium is an infrastructure problem, not a
    // problem with the uploaded file.
    const e = new DocxUnavailableError("could not launch chromium");
    e.cause = err;
    throw e;
  }
  try {
    const page = await browser.newPage();
    await page.setContent(pageHtml(html), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
