// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GET as termsTxt } from "../../app/terms.txt/route.js";
import { GET as privacyTxt } from "../../app/privacy.txt/route.js";
import { TERMS_SECTIONS } from "../../app/terms/terms-copy.js";
import { PRIVACY_SECTIONS } from "../../app/privacy/privacy-copy.js";
import TermsPage from "../../app/terms/page.js";
import PrivacyPage from "../../app/privacy/page.js";

afterEach(() => cleanup());

describe("plain-text legal twins", () => {
  it("terms.txt serves text/plain with content", async () => {
    const res = termsTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).length).toBeGreaterThan(100);
  });

  it("privacy.txt serves text/plain with content", async () => {
    const res = privacyTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).length).toBeGreaterThan(100);
  });

  it("terms.txt carries every section the page renders", async () => {
    const text = await termsTxt().text();
    expect(TERMS_SECTIONS.length).toBeGreaterThan(0);
    for (const section of TERMS_SECTIONS) {
      expect(text).toContain(`# ${section.heading}`);
      expect(text).toContain(section.body);
    }
  });

  it("privacy.txt carries every section the page renders", async () => {
    const text = await privacyTxt().text();
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    for (const section of PRIVACY_SECTIONS) {
      expect(text).toContain(`# ${section.heading}`);
      expect(text).toContain(section.body);
    }
  });
});

describe("legal pages link their twin", () => {
  it("terms page links /terms.txt and renders the shared sections", () => {
    render(createElement(TermsPage));
    const link = screen.getByRole("link", { name: "plain text version" });
    expect(link.getAttribute("href")).toBe("/terms.txt");
    for (const section of TERMS_SECTIONS) {
      expect(
        screen.getByRole("heading", { level: 2, name: section.heading }),
      ).toBeTruthy();
    }
  });

  it("privacy page links /privacy.txt and renders the shared sections", () => {
    render(createElement(PrivacyPage));
    const link = screen.getByRole("link", { name: "plain text version" });
    expect(link.getAttribute("href")).toBe("/privacy.txt");
    for (const section of PRIVACY_SECTIONS) {
      expect(
        screen.getByRole("heading", { level: 2, name: section.heading }),
      ).toBeTruthy();
    }
  });
});
