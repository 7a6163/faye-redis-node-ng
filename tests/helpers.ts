import type { FayeServer, FayeMessage } from '../src/types';

export class MockFayeServer implements FayeServer {
  timeout: number = 45;
  private _idCounter: number = 0;
  private _events: Map<string, Array<(...args: any[]) => void>> = new Map();
  private _connections: Set<string> = new Set();
  public debugMessages: string[] = [];

  generateId(): string {
    return `client_${++this._idCounter}_${Date.now()}`;
  }

  debug(...args: any[]): void {
    this.debugMessages.push(args.map(String).join(' '));
  }

  trigger(event: string, ...args: any[]): void {
    const handlers = this._events.get(event) || [];
    handlers.forEach(handler => handler(...args));
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    this._events.get(event)!.push(handler);
  }

  hasConnection(clientId: string): boolean {
    return this._connections.has(clientId);
  }

  addConnection(clientId: string): void {
    this._connections.add(clientId);
  }

  removeConnection(clientId: string): void {
    this._connections.delete(clientId);
  }

  deliver(clientId: string, messages: FayeMessage[]): void {
    // Mock delivery - just trigger an event
    this.trigger('deliver', clientId, messages);
  }

  clearEvents(): void {
    this._events.clear();
  }

  getEventHandlers(event: string): Array<(...args: any[]) => void> {
    return this._events.get(event) || [];
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(condition());
    if (result) {
      return;
    }
    await delay(interval);
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

export interface TestMessage {
  channel: string;
  data: any;
  clientId?: string;
}

export function createTestMessage(channel: string, data: any, clientId?: string): FayeMessage {
  return {
    channel,
    data,
    ...(clientId && { clientId })
  };
}
