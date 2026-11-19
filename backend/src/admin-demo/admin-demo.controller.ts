import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminDemoService } from './admin-demo.service';
import { CreateDemoPaymentDto } from './dto/create-demo-payment.dto';
import { SimulatedDateQueryDto } from './dto/simulated-date-query.dto';
import { UpdateDemoPaymentDto } from './dto/update-demo-payment.dto';
import type {
  DemoCustomerSummary,
  DemoPaymentWritten,
  DemoPaymentsView,
  DemoPreviewView,
  DemoResetView,
  DemoRestoreView,
} from './types/admin-demo.types';

/**
 * The personalisation testing dashboard's API. DEVELOPMENT ONLY.
 *
 * The three reads are GETs, the preview deliberately among them: that
 * it creates no suggestion offer is then evident from the method,
 * rather than merely promised in a comment. Everything that writes
 * touches demonstration history and nothing else.
 *
 * One @Roles on the controller, so a route added here is closed to
 * customers by default rather than by remembering to mark it. The
 * service refuses as well, and in production this controller is never
 * registered at all.
 */
@Roles('ADMIN')
@Controller('admin/demo')
export class AdminDemoController {
  constructor(private readonly demo: AdminDemoService) {}

  @Get('customers')
  @Header('Cache-Control', 'no-store')
  customers(): Promise<DemoCustomerSummary[]> {
    return this.demo.listCustomers();
  }

  @Get('customers/:userId/payments')
  @Header('Cache-Control', 'no-store')
  payments(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: SimulatedDateQueryDto,
  ): Promise<DemoPaymentsView> {
    return this.demo.listPayments(userId, query.at);
  }

  @Get('customers/:userId/preview')
  @Header('Cache-Control', 'no-store')
  preview(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: SimulatedDateQueryDto,
  ): Promise<DemoPreviewView> {
    return this.demo.preview(userId, query.at);
  }

  /**
   * Adds one demonstration record.
   *
   * Every write is nested under the customer it belongs to, so the row
   * is always resolved by payment AND customer. A request aimed at the
   * wrong customer's URL finds nothing rather than quietly changing
   * someone else's history.
   */
  @Post('customers/:userId/payments')
  @Header('Cache-Control', 'no-store')
  createPayment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateDemoPaymentDto,
  ): Promise<DemoPaymentWritten> {
    return this.demo.createPayment(userId, dto);
  }

  @Patch('customers/:userId/payments/:paymentId')
  @Header('Cache-Control', 'no-store')
  updatePayment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdateDemoPaymentDto,
  ): Promise<DemoPaymentWritten> {
    return this.demo.updatePayment(userId, paymentId, dto);
  }

  @Delete('customers/:userId/payments/:paymentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  deletePayment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<void> {
    return this.demo.deletePayment(userId, paymentId);
  }

  /**
   * Clears one customer's demonstration history.
   *
   * The collection, rather than one member of it, which is why this
   * shares a verb with the route above and differs only in having no
   * payment id. It answers with what went, so the dashboard can say so
   * instead of leaving an admin to infer it from an emptied table.
   */
  @Delete('customers/:userId/payments')
  @Header('Cache-Control', 'no-store')
  resetHistory(@Param('userId', ParseUUIDPipe) userId: string): Promise<DemoResetView> {
    return this.demo.resetHistory(userId);
  }

  /**
   * Writes the seeded fixture back.
   *
   * 200 rather than 201: this restores a known state at a path that
   * already existed, and there is no new resource to point a Location
   * header at.
   */
  @Post('customers/:userId/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  restore(@Param('userId', ParseUUIDPipe) userId: string): Promise<DemoRestoreView> {
    return this.demo.restoreFixture(userId);
  }
}
