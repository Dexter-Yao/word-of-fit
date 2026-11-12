// ABOUTME: Owns authenticated PayPal Sandbox requests and raw webhook signature verification.
// ABOUTME: Server credentials stay here, and provider requests always use the fixed Sandbox origin.

import type { IncomingMessage } from 'node:http';
import { HttpError } from '../http.ts';

export const ordersPath = '/v2/checkout/orders';
const sandboxOrigin = 'https://api-m.sandbox.paypal.com';
const verificationPath = '/v1/notifications/verify-webhook-signature';
const signatureFields = ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time'] as const;

export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export function paypalClientId(): string {
  return process.env.PAYPAL_SANDBOX_CLIENT_ID?.trim() ?? '';
}

export class PayPalError extends HttpError {
  readonly providerStatus: number;
  readonly issue: string | undefined;

  constructor(providerStatus: number, issue?: string) {
    super(502, 'PayPal Sandbox could not confirm the request. Try again with the same order.');
    this.providerStatus = providerStatus;
    this.issue = issue;
  }
}

type Authorization = { clientId: string; secret: string; token: string; expiresAt: number };
let authorization: Authorization | undefined;

async function send(method: string, path: string, headers: Headers, body?: string | Buffer): Promise<JsonObject> {
  let response: Response;
  let data: JsonObject | undefined;
  try {
    response = await fetch(sandboxOrigin + path, {
      method, headers, body, signal: AbortSignal.timeout(8_000), redirect: 'error',
    });
    data = object(await response.json().catch(() => undefined));
  } catch {
    throw new PayPalError(0);
  }
  if (!response.ok) {
    const issue = Array.isArray(data?.details) ? identifier(object(data.details[0])?.issue) : undefined;
    console.error('PayPal Sandbox request failed', {
      operation: method + ' ' + path.replace(/\/(orders|captures|refunds)\/[A-Za-z0-9_-]+/, '/$1/:id'),
      status: response.status,
      issue,
      debugId: identifier(data?.debug_id),
    });
    throw new PayPalError(response.status, issue);
  }
  if (!data) throw new PayPalError(0);
  return data;
}

async function accessToken(): Promise<string> {
  const clientId = paypalClientId();
  const secret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET?.trim();
  if (!clientId || !secret) throw new HttpError(503, 'PayPal Sandbox is unavailable.');
  if (authorization?.clientId === clientId && authorization.secret === secret && Date.now() < authorization.expiresAt) {
    return authorization.token;
  }

  const headers = new Headers({
    Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  const result = await send('POST', '/v1/oauth2/token', headers, 'grant_type=client_credentials');
  if (typeof result.access_token !== 'string' || !result.access_token ||
      typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
    throw new PayPalError(0);
  }
  authorization = {
    clientId, secret, token: result.access_token,
    expiresAt: Date.now() + Math.max(0, result.expires_in - 30) * 1000,
  };
  return authorization.token;
}

export async function paypal(
  method: 'GET' | 'POST', path: string, payload?: JsonObject | Buffer, requestId?: string,
): Promise<JsonObject> {
  const token = await accessToken();
  const headers = new Headers({ Authorization: 'Bearer ' + token, Accept: 'application/json' });
  const body = Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (requestId) {
    headers.set('PayPal-Request-Id', requestId);
    headers.set('Prefer', 'return=representation');
  }

  try {
    return await send(method, path, headers, body);
  } catch (error) {
    if (!(error instanceof PayPalError) || error.providerStatus !== 401) throw error;
    if (authorization?.token === token) authorization = undefined;
    headers.set('Authorization', 'Bearer ' + await accessToken());
    return send(method, path, headers, body);
  }
}

export async function verifyDelivery(raw: Buffer, request: IncomingMessage): Promise<{
  event: JsonObject;
  transmissionId: string;
}> {
  const webhookId = identifier(process.env.PAYPAL_SANDBOX_WEBHOOK_ID?.trim());
  if (!webhookId) throw new HttpError(503, 'PayPal webhook verification is unavailable.');

  const fields: Record<string, string> = { webhook_id: webhookId };
  for (const field of signatureFields) {
    const header = 'paypal-' + field.replaceAll('_', '-');
    const values = request.headersDistinct[header];
    if (values?.length !== 1 || !values[0] || values[0].length > 4096) {
      throw new HttpError(400, 'Expected PayPal signature headers.');
    }
    fields[field] = values[0];
  }
  const transmissionId = identifier(fields.transmission_id);
  if (!transmissionId) throw new HttpError(400, 'Invalid PayPal transmission ID.');

  let event: JsonObject | undefined;
  try {
    event = object(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)));
  } catch {
    throw new HttpError(400, 'Expected a PayPal event object.');
  }
  if (!event) throw new HttpError(400, 'Expected a PayPal event object.');

  const envelope = Buffer.concat([
    Buffer.from(JSON.stringify(fields).slice(0, -1) + ',"webhook_event":'),
    raw,
    Buffer.from('}'),
  ]);
  const result = await paypal('POST', verificationPath, envelope);
  if (result.verification_status === 'FAILURE') throw new HttpError(403, 'PayPal signature verification failed.');
  if (result.verification_status !== 'SUCCESS') throw new PayPalError(0);
  return { event, transmissionId };
}
