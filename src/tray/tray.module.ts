import { Module } from '@nestjs/common';
import { TrayController } from './tray.controller';
import { TrayService } from './tray.service';

@Module({
  controllers: [TrayController],
  providers: [TrayService],
  exports: [TrayService],
})
export class TrayModule {}
