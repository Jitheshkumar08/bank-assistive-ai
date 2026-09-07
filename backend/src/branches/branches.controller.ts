import { Controller, Get, Param } from '@nestjs/common';
import { BranchSummary, BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  findAll(): Promise<BranchSummary[]> {
    return this.branchesService.findAllActive();
  }

  @Get(':code')
  findOne(@Param('code') code: string): Promise<BranchSummary> {
    return this.branchesService.findByCode(code);
  }

}
