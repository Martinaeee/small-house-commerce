import {
  adminApi,
  type AdminFaqItem,
  type AdminFaqProductPage,
  type AdminFaqProductQuery,
  type AdminFaqProductCandidate,
  type AdminSharedFaq,
  type AdminSharedFaqImpact,
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
  previewSharedImpact: (
    items: AdminFaqItem[],
    expectedVersion: number,
  ): Promise<AdminSharedFaqImpact> =>
    adminApi.previewSharedFaqImpact({ items, expectedVersion }),
  updateShared: (
    items: AdminFaqItem[],
    expectedVersion: number,
  ): Promise<{ version: number }> =>
    adminApi.updateSharedFaq({ items, expectedVersion }),
};
