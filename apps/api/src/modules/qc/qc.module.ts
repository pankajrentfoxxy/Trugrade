import { Module } from '@nestjs/common';
import { QcService } from './qc.service';

@Module({
  providers: [QcService],
  exports: [QcService],
})
export class QcModule {}
