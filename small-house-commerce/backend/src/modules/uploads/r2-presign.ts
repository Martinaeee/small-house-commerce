import { createHash, createHmac } from 'node:crypto';

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

const REGION = 'auto';
const SERVICE = 's3';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

// AWS SigV4 uses strict RFC3986 percent encoding (encodeURIComponent misses !'()*).
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toAmzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

// Presigned PUT (SigV4 query-param auth), signed Content-Type, unsigned body.
// R2 endpoint shape: https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>
export function buildR2PresignedPutUrl(
  settings: R2Settings,
  key: string,
  contentType: string,
  expiresIn: number,
  now: Date = new Date(),
): PresignResult {
  const host = `${settings.accountId}.r2.cloudflarestorage.com`;
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${settings.bucket}/${key}`;
  const signedHeaders = 'content-type;host';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;

  const queryParts: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${settings.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const canonicalQueryString = queryParts
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${settings.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const baseUrl = settings.publicBaseUrl.replace(/\/+$/, '');
  return { uploadUrl, publicUrl: `${baseUrl}/${key}`, key, expiresIn };
}
