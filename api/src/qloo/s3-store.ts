import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { storedFileName, type ResponseStore, type StoredResponse } from "./cache.js";

export type S3Sender = Pick<S3Client, "send">;

export class S3Store implements ResponseStore {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Sender = new S3Client({}),
    private readonly prefix = "qloo/",
  ) {}

  async get(key: string): Promise<StoredResponse | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      const body = await response.Body?.transformToString();
      if (!body) return undefined;
      const entry = JSON.parse(body) as StoredResponse;
      return entry.key === key ? entry : undefined;
    } catch (error) {
      if ((error as { name?: string } | undefined)?.name === "NoSuchKey") return undefined;
      throw error;
    }
  }

  async set(entry: StoredResponse): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(entry.key),
        Body: JSON.stringify(entry),
        ContentType: "application/json",
      }),
    );
  }

  private objectKey(key: string): string {
    return `${this.prefix}${storedFileName(key)}`;
  }
}
