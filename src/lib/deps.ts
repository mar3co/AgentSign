export type Deps = {
  db?: unknown;
  store?: unknown;
  mailer?: unknown;
  now?: () => Date;
  auth?: unknown;
  stripe?: unknown;
};

let deps: Deps = {};

export function setDeps(next: Deps): void {
  deps = next;
}

export function getDeps(): Deps {
  return deps;
}
