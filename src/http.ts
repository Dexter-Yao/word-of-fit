// ABOUTME: Provides bounded request parsing and response helpers for the demo's HTTP routes.
// ABOUTME: Webhook handlers receive the original bytes for signature verification.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { ShowcaseWindow } from './mode.ts';

export type Context = {
  db: DatabaseSync;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  showcase?: ShowcaseWindow;
};

export type RouteHandler = (ctx: Context) => boolean | Promise<boolean>;

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function readRawBody(ctx: Context, limit = 262_144): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of ctx.request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) {
      ctx.response.setHeader('Connection', 'close');
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

export async function readJson(ctx: Context, limit?: number): Promise<Record<string, unknown>> {
  const body = await readRawBody(ctx, limit);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new HttpError(400, 'Expected valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function sendJson(ctx: Context, status: number, payload: unknown): void {
  ctx.response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  ctx.response.end(JSON.stringify(payload));
}

export function sendHtml(ctx: Context, status: number, html: string): void {
  ctx.response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  ctx.response.end(html);
}

export function redirect(ctx: Context, location: string): void {
  ctx.response.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  ctx.response.end();
}

const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEntities[character]);
}
