import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PermissionCode, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  AdminSearchQuery,
  AdminSearchResponse,
  CustomerSearchHit,
  OrderSearchHit,
  ProductSearchHit,
  SearchGroup,
  ShipmentSearchHit,
} from './dto/search.dto.js';
import {
  buildCustomerSearchQuery,
  buildOrderSearchQuery,
  buildProductSearchQuery,
  buildShipmentSearchQuery,
  normalizeSearchTerms,
  type SearchTerms,
} from './search.queries.js';

type ProductStatusValue = ProductSearchHit['status'];
type SkuStatusValue = NonNullable<ProductSearchHit['matchedSku']>['skuStatus'];

interface ProductSearchRow {
  product_id: string;
  name: string;
  product_code: string | null;
  slug: string;
  product_status: ProductStatusValue;
  matched_field: ProductSearchHit['matchedField'];
  matched_text: string;
  sku_id: string | null;
  sku_code: string | null;
  sku_status: SkuStatusValue | null;
  variant_id: string | null;
  variant_name: string | null;
  price: Prisma.Decimal | string | number | null;
  available_inventory: number;
}

interface OrderSearchRow {
  order_id: string;
  order_number: string;
  order_status: string;
  confirmation_status: string;
  customer_name: string | null;
  normalized_phone: string;
  created_at: Date | string;
  matched_field: OrderSearchHit['matchedField'];
  matched_text: string;
}

interface CustomerSearchRow {
  customer_id: string;
  name: string | null;
  normalized_phone: string;
  email: string | null;
  risk_level: string;
  matched_field: CustomerSearchHit['matchedField'];
  matched_text: string;
}

interface ShipmentSearchRow {
  shipment_id: string;
  tracking_number: string;
  carrier: string;
  status: string;
  order_id: string;
  order_number: string;
  matched_field: ShipmentSearchHit['matchedField'];
  matched_text: string;
}

function toGroup<T>(items: T[], limit: number): SearchGroup<T> {
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit,
  };
}

function mapProduct(row: ProductSearchRow): ProductSearchHit {
  const matchedSku =
    row.sku_id === null
      ? null
      : {
          skuId: row.sku_id,
          skuCode: row.sku_code!,
          skuStatus: row.sku_status!,
          variantId: row.variant_id!,
          variantName: row.variant_name!,
          price: row.price === null ? null : String(row.price),
          availableInventory: Number(row.available_inventory),
        };

  return {
    kind: 'PRODUCT',
    productId: row.product_id,
    name: row.name,
    productCode: row.product_code,
    slug: row.slug,
    status: row.product_status,
    matchedField: row.matched_field,
    matchedText: row.matched_text,
    matchedSku,
  };
}

function mapOrder(row: OrderSearchRow): OrderSearchHit {
  return {
    kind: 'ORDER',
    orderId: row.order_id,
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    confirmationStatus: row.confirmation_status,
    customerName: row.customer_name,
    normalizedPhone: row.normalized_phone,
    createdAt: new Date(row.created_at).toISOString(),
    matchedField: row.matched_field,
    matchedText: row.matched_text,
  };
}

function mapCustomer(row: CustomerSearchRow): CustomerSearchHit {
  return {
    kind: 'CUSTOMER',
    customerId: row.customer_id,
    name: row.name,
    normalizedPhone: row.normalized_phone,
    email: row.email,
    riskLevel: row.risk_level,
    matchedField: row.matched_field,
    matchedText: row.matched_text,
  };
}

function mapShipment(row: ShipmentSearchRow): ShipmentSearchHit {
  return {
    kind: 'SHIPMENT',
    shipmentId: row.shipment_id,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    status: row.status,
    orderId: row.order_id,
    orderNumber: row.order_number,
    matchedField: row.matched_field,
    matchedText: row.matched_text,
  };
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, query: AdminSearchQuery): Promise<AdminSearchResponse> {
    const permissions = await this.permissionsForActiveUser(userId);
    const terms = normalizeSearchTerms(query.q);
    const take = query.limit + 1;
    const groups: AdminSearchResponse['groups'] = {};
    const jobs: Promise<void>[] = [];

    if (permissions.has('PRODUCT_MANAGE')) {
      jobs.push(
        this.productGroup(terms, query.limit, take).then((group) => {
          groups.products = group;
        }),
      );
    }
    if (permissions.has('ORDER_VIEW_ALL')) {
      jobs.push(
        this.orderGroup(terms, query.limit, take).then((group) => {
          groups.orders = group;
        }),
        this.shipmentGroup(terms, query.limit, take).then((group) => {
          groups.shipments = group;
        }),
      );
    }
    if (permissions.has('CUSTOMER_MANAGE')) {
      jobs.push(
        this.customerGroup(terms, query.limit, take).then((group) => {
          groups.customers = group;
        }),
      );
    }

    await Promise.all(jobs);

    return {
      query: query.q,
      groups: {
        ...(groups.products ? { products: groups.products } : {}),
        ...(groups.orders ? { orders: groups.orders } : {}),
        ...(groups.customers ? { customers: groups.customers } : {}),
        ...(groups.shipments ? { shipments: groups.shipments } : {}),
      },
    };
  }

  private async permissionsForActiveUser(userId: string): Promise<Set<PermissionCode>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException();
    }

    return new Set(
      user.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.code),
      ),
    );
  }

  private async productGroup(
    terms: SearchTerms,
    limit: number,
    take: number,
  ): Promise<SearchGroup<ProductSearchHit>> {
    const rows = await this.prisma.$queryRaw<ProductSearchRow[]>(
      buildProductSearchQuery(terms, take),
    );
    return toGroup(rows.map(mapProduct), limit);
  }

  private async orderGroup(
    terms: SearchTerms,
    limit: number,
    take: number,
  ): Promise<SearchGroup<OrderSearchHit>> {
    const rows = await this.prisma.$queryRaw<OrderSearchRow[]>(
      buildOrderSearchQuery(terms, take),
    );
    return toGroup(rows.map(mapOrder), limit);
  }

  private async customerGroup(
    terms: SearchTerms,
    limit: number,
    take: number,
  ): Promise<SearchGroup<CustomerSearchHit>> {
    const rows = await this.prisma.$queryRaw<CustomerSearchRow[]>(
      buildCustomerSearchQuery(terms, take),
    );
    return toGroup(rows.map(mapCustomer), limit);
  }

  private async shipmentGroup(
    terms: SearchTerms,
    limit: number,
    take: number,
  ): Promise<SearchGroup<ShipmentSearchHit>> {
    const rows = await this.prisma.$queryRaw<ShipmentSearchRow[]>(
      buildShipmentSearchQuery(terms, take),
    );
    return toGroup(rows.map(mapShipment), limit);
  }
}
