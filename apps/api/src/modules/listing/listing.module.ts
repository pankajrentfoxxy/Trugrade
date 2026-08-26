import { Module } from '@nestjs/common';
import { ListingService } from './listing.service';

@Module({
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}
