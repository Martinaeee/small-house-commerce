import {
  adminApi,
  type AdminFaqItem,
  type AdminFaqProductPage,
  type AdminFaqProductQuery,
  type AdminFaqProductCandidate,
  type AdminSharedFaq,
} from "./admin-api";

export const faqApi = {
  getShared: (): Promise<AdminSharedFaq> => adminApi.getSharedFaq(),
  getSharedPreview: (): Promise<{ items: AdminFaqItem[] }> =>
    adminApi.getSharedFaqPreview(),
  getProductGroups: (
    query: AdminFaqProductQuery = {},
  ): Promise<AdminFaqProductPage> => adminApi.listFaqProducts(query),
  listProducts: (query: {
    search?: string;
    ids?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ items: AdminFaqProductCandidate[]; total: number }> =>
    adminApi.listFaqPickProducts(query),
  updateShared: (
    items: AdminFaqItem[],
    expectedVersion: number,
  ): Promise<{ version: number }> =>
    adminApi.updateSharedFaq({ items, expectedVersion }),
};
