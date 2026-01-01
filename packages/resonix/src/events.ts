/**
 * Event emitter class inspired by Node.js EventEmitter
 */
export class EventEmitter<Events extends Record<string, any[]>> {
  private listeners = new Map<
    keyof Events,
    Set<(...args: any[]) => void | Promise<void>>
  >();

  /**
   * Register a listener for an event.
   * @param event Event name
   * @param listener Callback function (can be async)
   */
  public on<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void | Promise<void>,
  ): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  /**
   * Register a listener that fires only once.
   * @param event Event name
   * @param listener Callback function (can be async)
   */
  public once<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void | Promise<void>,
  ): this {
    const onceWrapper = async (...args: Events[K]) => {
      await listener(...args);
      this.off(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * Remove a listener from an event.
   * @param event Event name
   * @param listener Callback function to remove
   */
  public off<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void | Promise<void>,
  ): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified.
   * @param event Optional event name
   */
  public removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  /**
   * Get the number of listeners for an event.
   * @param event Event name
   */
  public listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Emit an event, calling all registered listeners sequentially.
   * @param event Event name
   * @param args Arguments to pass to listeners
   */
  protected async emit<K extends keyof Events>(
    event: K,
    ...args: Events[K]
  ): Promise<void> {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return;

    for (const listener of Array.from(listeners)) {
      try {
        await listener(...args);
      } catch (error) {
        // Log error but don't stop other listeners
        console.error(
          `[resonix] error in listener for event "${String(event)}"`,
          error,
        );
      }
    }
  }
}
