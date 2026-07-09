import { Module } from '@nestjs/common';
import { PostOpService } from './post-op.service';

@Module({
  providers: [PostOpService],
  exports: [PostOpService],
})
export class PostOpModule {}
