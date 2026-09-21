import OSS from 'ali-oss';
import { config } from '../config';

class OssClient {
  private static instance: OssClient;
  public client: OSS | null = null;
  public isConfigured: boolean = false;

  private constructor() {
    this.init();
  }

  public static getInstance(): OssClient {
    if (!OssClient.instance) {
      OssClient.instance = new OssClient();
    }
    return OssClient.instance;
  }

  private init() {
    const { enabled, region, accessKeyId, accessKeySecret, bucket } = config.oss;
    const isRealValue = (value: string, placeholders: string[] = []) => {
      const normalized = value.trim();
      return normalized.length > 0 && !placeholders.includes(normalized);
    };
    const hasCompleteCredentials = isRealValue(region)
      && isRealValue(accessKeyId, ['your_oss_access_key_id'])
      && isRealValue(accessKeySecret, ['your_oss_access_key_secret'])
      && isRealValue(bucket, ['your_oss_bucket_name']);

    // OSS is deliberately opt-in and requires every credential. This lets the
    // same build run entirely from persistent local storage.
    if (enabled && hasCompleteCredentials) {

      try {
        this.client = new OSS({
          region,
          accessKeyId,
          accessKeySecret,
          bucket,
          secure: true,
        });
        this.isConfigured = true;
        console.log('[OSS] Aliyun OSS Client initialized successfully.');
      } catch (error) {
        console.error('[OSS] Failed to initialize Aliyun OSS Client:', error);
      }
    } else if (enabled) {
      console.warn('[OSS] OSS_ENABLED=true but credentials are incomplete. Local storage fallback will be used.');
    } else {
      console.info('[OSS] Disabled. Local storage will be used for uploads.');
    }
  }

  /**
   * Upload buffer to OSS and return the CDN URL
   * @param objectName The path and filename in OSS bucket
   * @param buffer The file buffer
   * @param mimeType Optional MIME type
   * @returns The CDN URL if successful, otherwise null
   */
  public async uploadBuffer(objectName: string, buffer: Buffer, mimeType?: string): Promise<string | null> {
    if (!this.client || !this.isConfigured) return null;

    try {
      const options: OSS.PutObjectOptions = {};
      if (mimeType) {
        options.mime = mimeType;
        options.headers = {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=2592000' // Cache for 30 days at CDN edges
        };
      }

      await this.client.put(objectName, buffer, options);

      const cdnDomain = config.oss.cdnDomain || `https://${config.oss.bucket}.${config.oss.region}.aliyuncs.com`;
      // Ensure cdnDomain doesn't end with slash
      const baseUrl = cdnDomain.endsWith('/') ? cdnDomain.slice(0, -1) : cdnDomain;

      return `${baseUrl}/${objectName}`;
    } catch (error) {
      console.error(`[OSS] Failed to upload ${objectName}:`, error);
      return null;
    }
  }
}

export const ossClient = OssClient.getInstance();
