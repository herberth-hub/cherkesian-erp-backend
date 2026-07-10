import { Module } from '@nestjs/common';
import { PcpController } from './pcp.controller';
import { PcpService } from './pcp.service';

@Module({
  controllers: [PcpController],
  providers: [PcpService],
})
export class PcpModule {}
