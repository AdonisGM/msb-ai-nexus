import { Module } from '@nestjs/common'
import { OBJECT_STORE, S3ObjectStore } from './object-store'

@Module({
  providers: [{ provide: OBJECT_STORE, useClass: S3ObjectStore }],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
