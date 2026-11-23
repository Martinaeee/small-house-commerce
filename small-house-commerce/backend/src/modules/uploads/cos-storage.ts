import COS from 'cos-nodejs-sdk-v5';

export interface CosSettings {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  publicBaseUrl: string;
}

export function isCompleteCos(
  settings: Partial<CosSettings> | null | undefined,
): settings is CosSettings {
  return Boolean(
    settings?.secretId &&
      settings.secretKey &&
      settings.bucket &&
      settings.region &&
      settings.publicBaseUrl,
  );
}

/**
 * Tencent COS uploads through the official SDK. Server-side only: the browser
 * keeps sending bytes to our admin API, which decides where they land, so the
 * secret never reaches the client and the bucket can stay private-write.
 */
export class CosStorage {
  private readonly client: COS;

  constructor(private readonly settings: CosSettings) {
    this.client = new COS({
      SecretId: settings.secretId,
      SecretKey: settings.secretKey,
    });
  }

  publicUrl(key: string): string {
    return `${this.settings.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }

  putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.putObject(
        {
          Bucket: this.settings.bucket,
          Region: this.settings.region,
          Key: key,
          Body: body,
          ContentType: contentType,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }
}
