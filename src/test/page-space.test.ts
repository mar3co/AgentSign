import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  areaToPageRect,
  displayPointToPage,
  pagePointToDisplay,
  pageSpaceOf,
  type PageSpace,
} from "../lib/pdf/pageSpace.js";

const cropped: Omit<PageSpace, "rotation" | "displayW" | "displayH"> = {
  cropX: 30,
  cropY: 40,
  cropW: 500,
  cropH: 700,
};

function space(rotation: PageSpace["rotation"]): PageSpace {
  const sideways = rotation === 90 || rotation === 270;
  return {
    ...cropped,
    rotation,
    displayW: sideways ? cropped.cropH : cropped.cropW,
    displayH: sideways ? cropped.cropW : cropped.cropH,
  };
}

async function rotatedPdf(rotation: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.setRotation(degrees(rotation));
  page.setCropBox(cropped.cropX, cropped.cropY, cropped.cropW, cropped.cropH);
  return doc.save();
}

describe("pageSpace", () => {
  it("maps display points to user space for every rotation", () => {
    // Display origin (bottom-left of the displayed page) per rotation.
    expect(displayPointToPage(space(0), 0, 0)).toEqual({ x: 30, y: 40 });
    expect(displayPointToPage(space(90), 0, 0)).toEqual({ x: 530, y: 40 });
    expect(displayPointToPage(space(180), 0, 0)).toEqual({ x: 530, y: 740 });
    expect(displayPointToPage(space(270), 0, 0)).toEqual({ x: 30, y: 740 });
    // An interior point: 100 right, 50 up from the displayed corner.
    expect(displayPointToPage(space(90), 100, 50)).toEqual({ x: 480, y: 140 });
    expect(displayPointToPage(space(270), 100, 50)).toEqual({ x: 80, y: 640 });
  });

  it("round-trips display points through user space for every rotation", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const s = space(rotation);
      for (const [dx, dy] of [[0, 0], [100, 50], [321.5, 87.25]]) {
        const p = displayPointToPage(s, dx!, dy!);
        const back = pagePointToDisplay(s, p.x, p.y);
        expect(back.x).toBeCloseTo(dx!);
        expect(back.y).toBeCloseTo(dy!);
      }
    }
  });

  it("swaps the displayed area's width and height on sideways pages", () => {
    const r = areaToPageRect(space(90), { page: 1, x: 25, y: 50, w: 25, h: 10 });
    // displayW=700, displayH=500: display rect x=175 w=175, 10% tall = 50pt.
    expect(r.w).toBeCloseTo(50);
    expect(r.h).toBeCloseTo(175);
  });

  it("intersects the CropBox with the MediaBox like pdfjs does", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setCropBox(-50, 100, 700, 800);
    const s = pageSpaceOf(page);
    expect(s).toMatchObject({ cropX: 0, cropY: 100, cropW: 612, cropH: 692 });
  });

  it("falls back to the MediaBox when the CropBox misses it entirely", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setCropBox(1000, 1000, 100, 100);
    const s = pageSpaceOf(page);
    expect(s).toMatchObject({ cropX: 0, cropY: 0, cropW: 612, cropH: 792 });
  });

  it("agrees with pdfjs when the CropBox overflows the MediaBox", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(90));
    page.setCropBox(-50, 100, 700, 800);
    const bytes = await doc.save();
    const libDoc = await PDFDocument.load(bytes);
    const s = pageSpaceOf(libDoc.getPage(0));
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(),
      disableWorker: true,
      isEvalSupported: false,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise;
    const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
    expect(s.displayW).toBeCloseTo(viewport.width);
    expect(s.displayH).toBeCloseTo(viewport.height);
    const got = displayPointToPage(s, 123, viewport.height - 45);
    const [ex, ey] = viewport.convertToPdfPoint(123, 45) as number[];
    expect(got.x).toBeCloseTo(ex!, 6);
    expect(got.y).toBeCloseTo(ey!, 6);
  });

  it("agrees with the pdfjs viewport for every rotation", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const rotation of [0, 90, 180, 270]) {
      const bytes = await rotatedPdf(rotation);
      const libDoc = await PDFDocument.load(bytes);
      const s = pageSpaceOf(libDoc.getPage(0));
      const pdf = await pdfjs.getDocument({
        data: bytes.slice(),
        disableWorker: true,
        isEvalSupported: false,
      } as Parameters<typeof pdfjs.getDocument>[0]).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect(s.displayW).toBeCloseTo(viewport.width);
      expect(s.displayH).toBeCloseTo(viewport.height);
      const samples: [number, number][] = [
        [0, 0],
        [viewport.width, viewport.height],
        [123, 45],
      ];
      for (const [vx, vy] of samples) {
        // Viewport y runs top-down; display space runs bottom-up.
        const got = displayPointToPage(s, vx, viewport.height - vy);
        const [ex, ey] = viewport.convertToPdfPoint(vx, vy) as number[];
        expect(got.x).toBeCloseTo(ex!, 6);
        expect(got.y).toBeCloseTo(ey!, 6);
      }
    }
  });
});
