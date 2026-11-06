import { Module } from '@nestjs/common'
import { FeeService } from './fee.service.js'

@Module({ providers: [FeeService], exports: [FeeService] })
export class FeesModule {}
