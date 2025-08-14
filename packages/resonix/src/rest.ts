import type { CreatePlayerPayload, ResonixFiltersPayload } from "./types.js";

/**
 * Lightweight wrapper around the Resonix REST API.
 *
 * Provides convenience methods for player lifecycle + filter operations.
 */
export class ResonixRest {
  /**
   * @param base Fully qualified base URL (e.g. `http://localhost:2333/v0`).
   * @param fetcher Optional custom fetch implementation.
   */
  constructor(
    private readonly base: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Build a full request URL from a path fragment. */
  private url(p: string) {
    return `${this.base}${p}`;
  }

  /**
   * Create a new player on the backend.
   * @param d Player payload (id + uri).
   * @returns Parsed JSON body if provided; undefined on empty.
   * @throws Error on non-2xx response status.
   */
  async createPlayer(d: CreatePlayerPayload) {
    const res = await this.fetcher(this.url("/players"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(d),
    });
    if (!res.ok) throw new Error(`createPlayer failed: ${res.status}`);
    return res.json().catch(() => undefined);
  }

  /**
   * Delete a player. Errors from the HTTP request are ignored.
   * @param id Player identifier.
   */
  async deletePlayer(id: string) {
    await this.fetcher(this.url(`/players/${id}`), { method: "DELETE" }).catch(
      () => undefined,
    );
  }

  /**
   * Start or resume playback for a player.
   * @param id Player identifier.
   */
  async play(id: string) {
    await this.fetcher(this.url(`/players/${id}/play`), { method: "POST" });
  }

  /**
   * Pause playback for a player.
   * @param id Player identifier.
   */
  async pause(id: string) {
    await this.fetcher(this.url(`/players/${id}/pause`), { method: "POST" });
  }

  /**
   * Apply filter changes (e.g., volume) to a player.
   * @param id Player identifier.
   * @param d Partial filter payload.
   */
  async filters(id: string, d: ResonixFiltersPayload) {
    await this.fetcher(this.url(`/players/${id}/filters`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(d),
    });
  }
}
