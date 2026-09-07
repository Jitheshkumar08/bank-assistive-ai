import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ContextService, ResolvedContext } from './context.service';
import { ResolveContextDto } from './dto/resolve-context.dto';

@Controller('context')
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@Body() dto: ResolveContextDto): Promise<ResolvedContext> {
    return this.contextService.resolve(dto);
  }
}
