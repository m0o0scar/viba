import type { AuthSessionPayload } from '@/lib/auth/session-token';

const textEncoder = new TextEncoder();

function toBase64(value: string): string {
  const bytes = textEncoder.encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function toBase64Url(input: Uint8Array | string): string {
  const raw = typeof input === 'string' ? toBase64(input) : btoa(String.fromCharCode(...input));
  return raw.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return normalized + padding;
}

async function sign(content: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(content));
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyAuthSessionTokenEdge(token: string, secret: string): Promise<AuthSessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const unsignedToken = `${headerSegment}.${payloadSegment}`;
  const expectedSignature = await sign(unsignedToken, secret);

  if (expectedSignature !== signatureSegment) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64(base64UrlToBase64(payloadSegment))) as AuthSessionPayload;
    if (!payload?.email || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
