import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { ServiceUnavailableException } from '@nestjs/common'
import {
  S3_ACCESS_KEY,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_KEY,
  STORAGE_ENABLED,
} from '../env'

/** Where file bytes go. Postgres keeps what a file is; this keeps what is in
 *  it.
 *
 *  An interface rather than the S3 client itself, so the services that use it
 *  can be tested against a map in memory — the tests are about who may attach
 *  what, not about whether SeaweedFS works. */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  remove(keys: string[]): Promise<void>
}

export const OBJECT_STORE = Symbol('OBJECT_STORE')

/** The real one: any S3-compatible endpoint. */
export class S3ObjectStore implements ObjectStore {
  private client: S3Client | null = null

  /** Checked once per process rather than on every write. A fresh SeaweedFS
   *  volume starts with no buckets at all, and asking an operator to create one
   *  by hand is a step that gets forgotten on exactly one server. */
  private bucketReady: Promise<void> | null = null

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket()
    await this.s3().send(
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    )
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    if (!out.Body) throw new Error(`object_empty:${key}`)
    return Buffer.from(await out.Body.transformToByteArray())
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this.s3().send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    )
  }

  private s3(): S3Client {
    if (!STORAGE_ENABLED) throw new ServiceUnavailableException('storage_not_configured')
    this.client ??= new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
      /** SeaweedFS, like most self-hosted stores, answers on one host rather
       *  than on a subdomain per bucket. */
      forcePathStyle: true,
    })
    return this.client
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.s3().send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
      } catch {
        await this.s3().send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
      }
    })().catch((error: unknown) => {
      /** Forgotten on failure, so the next upload tries again rather than
       *  every upload failing until a restart. */
      this.bucketReady = null
      throw error
    })
    return this.bucketReady
  }
}
