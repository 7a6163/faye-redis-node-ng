import { RedisClientType } from 'redis';

export interface EngineOptions {
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  namespace?: string;
  socket?: string;
  gc?: number;
}

export interface FayeMessage {
  clientId?: string;
  channel: string;
  data: any;
  id?: string;
}

export interface FayeServer {
  timeout: number;
  generateId(): string;
  debug(...args: any[]): void;
  trigger(event: string, ...args: any[]): void;
  hasConnection(clientId: string): boolean;
  deliver(clientId: string, messages: FayeMessage[]): void;
}

export type RedisClient = RedisClientType;

export type CallbackContext = any;

export type EmptyCallback = () => void;
export type ClientCallback = (clientId: string) => void;
export type ExistsCallback = (exists: boolean) => void;
