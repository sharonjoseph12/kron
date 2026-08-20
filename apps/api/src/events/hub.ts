import { EventEmitter } from "node:events";
import type { StreamEvent } from "@kron/shared";
import { SSE_KEEPALIVE_MS } from "@kron/shared";

type Listener = (event: StreamEvent) => void;

/**
 * In-memory broadcast hub for the SSE event stream (/api/events).
 * Timeline/payment/decision events are persisted in Postgres by their
 * services and then published here for live delivery to dashboard clients.
 */
export class EventHub {
  private emitter = new EventEmitter();
  private listeners = new Set<Listener>();
  private stats = { delivered: 0, dropped: 0 };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: StreamEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
        this.stats.delivered += 1;
      } catch {
        this.stats.dropped += 1;
      }
    }
    this.emitter.emit("event", event);
  }

  /** Emitted once for each published event (used by non-SSE consumers). */
  onEvent(listener: Listener): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  getStats() {
    return { ...this.stats, liveClients: this.listeners.size };
  }
}

export const hub = new EventHub();

export const SSE_KEEPALIVE = SSE_KEEPALIVE_MS;

/** Format a StreamEvent as an SSE data frame (event: <type>). */
export function toSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
