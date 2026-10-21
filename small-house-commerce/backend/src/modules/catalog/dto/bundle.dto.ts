import { z } from 'zod';

export const bundleComponentsSchema = z.array(z.object({
  componentSkuId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  position: z.number().int().min(0).max(1000),
}).strict()).min(1).max(20).superRefine((components, ctx) => {
  const ids = new Set<string>();
  for (const [index, component] of components.entries()) {
    if (ids.has(component.componentSkuId)) {
      ctx.addIssue({ code: 'custom', path: [index, 'componentSkuId'], message: 'Each component SKU can appear only once.' });
    }
    ids.add(component.componentSkuId);
  }
});

export const setBundleComponentsSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  components: bundleComponentsSchema,
}).strict();

export type BundleComponentInput = z.infer<typeof bundleComponentsSchema>[number];
export type SetBundleComponentsInput = z.infer<typeof setBundleComponentsSchema>;
