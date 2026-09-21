import type { ObjectStore } from '../storage/object-store'

/** Object storage as a map, for tests.
 *
 *  What the attachment tests are about is who may attach what and what the
 *  model is sent — not whether SeaweedFS keeps bytes, which is its job. A
 *  store that can be told to fail is also the only way to test what happens
 *  when it does. */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()
  failing = false

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failing) throw new Error('store_down')
    this.objects.set(key, { body, contentType })
  }

  async get(key: string): Promise<Buffer> {
    if (this.failing) throw new Error('store_down')
    const found = this.objects.get(key)
    if (!found) throw new Error(`no_such_key:${key}`)
    return found.body
  }

  async remove(keys: string[]): Promise<void> {
    if (this.failing) throw new Error('store_down')
    for (const key of keys) this.objects.delete(key)
  }
}
