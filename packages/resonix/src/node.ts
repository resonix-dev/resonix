import { ResonixRest } from "./rest.js";
import type { ResonixNodeOptions } from "./types.js";

/**
 * Represents a connection target (base URL + version) for a Resonix backend.
 * Holds a shared REST client instance.
 */
export class ResonixNode {
  public readonly rest: ResonixRest;
  /** Create a new node instance. */
  constructor(public readonly options: ResonixNodeOptions) {
    const version = options.version ? `/${options.version}` : "";
    const base = options.baseUrl.endsWith("/")
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    this.rest = new ResonixRest(`${base}${version}`, options.fetch ?? fetch);
  }
}
