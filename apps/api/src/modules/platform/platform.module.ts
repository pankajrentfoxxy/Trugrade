import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service';

@Module({
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
