import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminBranch, AdminOverview, AdminService } from './admin.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

/**
 * The staff screen's API.
 *
 * One @Roles on the controller, so a route added here is closed to
 * customers by default rather than by remembering to mark it.
 */
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  overview(): Promise<AdminOverview> {
    return this.adminService.overview();
  }

  @Get('branches')
  listBranches(): Promise<AdminBranch[]> {
    return this.adminService.listBranches();
  }

  @Get('branches/:id')
  findBranch(@Param('id', ParseUUIDPipe) id: string): Promise<AdminBranch> {
    return this.adminService.findBranch(id);
  }

  @Post('branches')
  createBranch(@Body() dto: CreateBranchDto): Promise<AdminBranch> {
    return this.adminService.createBranch(dto);
  }

  @Patch('branches/:id')
  updateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<AdminBranch> {
    return this.adminService.updateBranch(id, dto);
  }

  @Delete('branches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBranch(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.adminService.deleteBranch(id);
  }
}
