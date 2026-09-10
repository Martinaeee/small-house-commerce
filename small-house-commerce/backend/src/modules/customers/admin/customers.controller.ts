import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CustomersService } from '../customers.service.js';
import {
  createCustomerSchema,
  customerAddressSchema,
  customerAddressUpdateSchema,
  customerQuerySchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerAddressInput,
  type CustomerAddressUpdateInput,
  type CustomerQuery,
  type UpdateCustomerInput,
} from '../dto/customer.dto.js';

@Controller('admin/customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('CUSTOMER_MANAGE')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(customerQuerySchema)) query: CustomerQuery) {
    return this.customers.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createCustomerSchema)) input: CreateCustomerInput) {
    return this.customers.create(input);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) input: UpdateCustomerInput,
  ) {
    return this.customers.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customers.remove(id);
  }

  @Get(':id/addresses')
  listAddresses(@Param('id') id: string) {
    return this.customers.listAddresses(id);
  }

  @Post(':id/addresses')
  addAddress(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(customerAddressSchema)) input: CustomerAddressInput,
  ) {
    return this.customers.addAddress(id, input);
  }

  @Patch(':id/addresses/:addressId')
  updateAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body(new ZodValidationPipe(customerAddressUpdateSchema)) input: CustomerAddressUpdateInput,
  ) {
    return this.customers.updateAddress(id, addressId, input);
  }

  @Delete(':id/addresses/:addressId')
  removeAddress(@Param('id') id: string, @Param('addressId') addressId: string) {
    return this.customers.removeAddress(id, addressId);
  }
}
