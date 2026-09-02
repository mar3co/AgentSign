import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { openapi } from "../openapi.js";

const APP_DIR = join(__dirname, "../../app");
const APP_V1_DIR = join(APP_DIR, "v1");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * OpenAPI path -> the route file's actual path, for routes reached only
 * through a rewrite (see next.config.ts). Keep this small: it's an
 * allowlist of known aliases, not a general path-mapping mechanism.
 */
const ALIASES: Record<string, string> = {
  "/v1/documents/{id}.pdf": "/v1/documents/{id}/pdf",
};
const REVERSE_ALIASES = Object.fromEntries(
  Object.entries(ALIASES).map(([spec, real]) => [real, spec]),
);

function walkRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkRouteFiles(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/** app/v1/documents/[id]/route.ts -> /v1/documents/{id} */
function routePathFor(file: string): string {
  const rel = relative(APP_DIR, file);
  const withoutRoute = rel.slice(0, -"/route.ts".length);
  const segments = withoutRoute
    .split(sep)
    .map((seg) => (seg.startsWith("[") && seg.endsWith("]") ? `{${seg.slice(1, -1)}}` : seg));
  return `/${segments.join("/")}`;
}

function methodsFor(file: string): HttpMethod[] {
  const src = readFileSync(file, "utf8");
  return HTTP_METHODS.filter((method) => {
    const fnExport = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
    const constExport = new RegExp(`export\\s+const\\s+${method}\\s*(?::\\s*[^=]+)?=`);
    const reExport = new RegExp(`export\\s*\\{[^}]*\\bas\\s+${method}\\b[^}]*\\}`);
    return fnExport.test(src) || constExport.test(src) || reExport.test(src);
  });
}

const routeFiles = walkRouteFiles(APP_V1_DIR);
const routesByPath = new Map<string, HttpMethod[]>();
for (const file of routeFiles) {
  routesByPath.set(routePathFor(file), methodsFor(file));
}

describe("OpenAPI doc matches app/v1/** routes", () => {
  it("documents every method a real /v1 route file exports", () => {
    const missing: string[] = [];
    for (const [routePath, methods] of routesByPath) {
      const specPath = REVERSE_ALIASES[routePath] ?? routePath;
      const specOperations = (openapi.paths as Record<string, Record<string, unknown>>)[
        specPath
      ];
      for (const method of methods) {
        if (!specOperations?.[method.toLowerCase()]) {
          missing.push(`${method} ${routePath} (expected in openapi.paths["${specPath}"])`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has a real route file behind every /v1 path in the OpenAPI doc", () => {
    const missing: string[] = [];
    for (const [specPath, operations] of Object.entries(openapi.paths)) {
      if (!specPath.startsWith("/v1")) continue;
      const routePath = ALIASES[specPath] ?? specPath;
      const methods = routesByPath.get(routePath);
      for (const method of Object.keys(operations)) {
        const httpMethod = method.toUpperCase() as HttpMethod;
        if (!methods?.includes(httpMethod)) {
          missing.push(`${method.toUpperCase()} ${specPath} (no app/v1${routePath}/route.ts export)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
