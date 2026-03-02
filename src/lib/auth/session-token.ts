import crypto from 'node:crypto';

export type AuthSessionPayload = {
  email: string;
  exp: number;
  iat: number;
};

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const base64 = input
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + padding, 'base64');
}

function sign(content: string, secret: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(content).digest());
}

export function createAuthSessionToken(
  email: string,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthSessionPayload = {
    email,
    iat: now,
    exp: now + ttlSeconds,
  };

  const headerSegment = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${headerSegment}.${payloadSegment}`;
  const signature = sign(unsignedToken, secret);

  return `${unsignedToken}.${signature}`;
}

export function verifyAuthSessionToken(token: string, secret: string): AuthSessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerSegment, payloadSegment, signature] = parts;
  const unsignedToken = `${headerSegment}.${payloadSegment}`;
  const expectedSignature = sign(unsignedToken, secret);

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadSegment).toString('utf8')) as AuthSessionPayload;
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
