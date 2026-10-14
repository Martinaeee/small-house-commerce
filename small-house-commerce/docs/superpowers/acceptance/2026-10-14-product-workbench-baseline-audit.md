# Product Workbench Baseline Audit

**Audit started:** 2026-10-14  
**Audit completed:** 2026-10-15  
**Deployed baseline:** `d20e2aee63a10cc69f371d52a9ef2cac7d8fe178`  
**Decision:** **NO-OP — already shipped. Do not import or deploy Product Workbench/media again.**

## Scope

This audit checks the presentation-only requirements in `2026-10-09-admin-product-workbench.md` against the post-Release-B baseline:

- compact admin controls;
- a wider editor beside a fixed 280px rail;
- compact media cards with hover, focus, and touch actions;
- multi-file batch upload with a save lock and named partial failures;
- contained desktop/mobile live-preview scrolling.

It does not certify FAQ, Marketing, Variant Dimensions/Packaging, Bundle inventory, Product Card V2 persistence, or Homepage Builder behavior. No feature source was imported from the shared dirty worktree.

## Historical patch audit

Seven donor patches have exact stable patch IDs in the deployed history. The remaining compact-control patch is semantically present under a different patch because the donor's `VariantMatrix` ancestry diverged.

| Donor commit | Stable patch ID | Deployed commit | Finding |
|---|---|---|---|
| `a461c4f` | `5313fcb1b54533b0e122b68a628676db9fadca54` | `845047352f607a60bb58f345ced431c96fdbceee` | Semantic equivalent. The deployed tree has the same compact `Field` contract/tests and compact admin controls; the donor patch ID differs at `VariantMatrix`. |
| `3b317bd` | `eeebf4d23cf6ee46db044919837c852ed6e8b903` | `cb6d1e7f85b66fc64d8a04e476d7036c926a0b66` | Exact patch-id match. |
| `817d091` | `dfbfd192be5e697685e3949c5942cdce1b3ac578` | `979df694bd9a273d30c55ce1964a72d7b8d4fe0d` | Exact patch-id match. |
| `cf359d8` | `1290b5d123685c6bc901e7981f2a15809085e1b3` | `2a79055c215ae018b272184927269725597394f8` | Exact patch-id match. |
| `bc99a78` | `6e21ad9a4eb03414871a2155b3e187da7fee168e` | `d8eecdeceda54badc1b1a29048b32affd3d552a1` | Exact patch-id match. |
| `249f0d4` | `2f9f08d0c9d639821993306770171e1339726912` | `79f6993877b74bfe72f8ffaf158aa24a4d14e8da` | Exact patch-id match. |
| `aff2385` | `aabc7085c7a7b007f319a4af8c367a7eed3d8ffe` | `18d476d4f84ee9e48ff7248040af67be72678649` | Exact patch-id match. |
| `893c33b` | `3d3919ed94b22618bae2b7518dce6eff0239378a` | `1ee41600f646300e92d896398e26417ae1c7a396` | Exact patch-id match. |

The semantic check for `a461c4f` independently confirmed:

- `inputClsCompact` retains `py-2 text-sm` while storefront-sized `inputCls` retains `py-2.5 text-base`;
- `TextInput`, `Select`, and `Textarea` use compact admin density;
- `ImageUrlInput` and matrix controls use the compact layout;
- the deployed `Field.spec.tsx` pins the split contract.

No unmatched Product Workbench behavior remains. Donor-only `VariantMatrix` differences belong to the separately planned Variant Dimensions/Packaging and Bundle waves and must not enter this no-op audit.

## Focused test gate

The six required files ran on the clean post-Release-B tree without importing donor changes:

```text
Test Files  6 passed (6)
Tests       94 passed (94)
Duration    4.31s
```

Covered files:

- `Field.spec.tsx`
- `ProductForm.spec.tsx`
- `MediaAddRow.spec.tsx`
- `SharedMediaWorkspace.spec.tsx`
- `ProductPreviewPanel.spec.tsx`
- `useMediaBatchUpload.spec.tsx`

## Real-browser gate

The gate used an ephemeral PostgreSQL 18 container on host port 55432 with the guard-required database `small_house_variant_test`. Backend/frontend ports 3210/3211 were proven free before use and were free again after Playwright exited. Shared PostgreSQL on 5432, production, and other session runtimes were not used.

Final Chromium result:

```text
Running 3 tests using 1 worker
✓ existing 375x812 / 768x1024 / 1280x720 responsive editor scenario
✓ exact 390/1280 compact layout, batch save lock, hover/focus, and preview scroll scenario
✓ exact 390px touch/no-hover media-actions scenario
3 passed (19.6s)
```

Observed behavior:

- all seven editor panels remained usable without root horizontal overflow;
- compact controls measured 36–39px high;
- the desktop rail measured 280px;
- the batch queue reported `1/3`, held the save button disabled across tab changes, continued after one named upload failure, appended two successes, and re-enabled save when complete;
- hover and keyboard focus exposed interactive card actions;
- a real `hasTouch` and `hover:none` context exposed the same actions with computed `opacity: 1` and `pointer-events: auto`;
- both live-preview device scrollers contained real long content, accepted wheel scrolling at a hit-tested point, and did not move the outer admin page;
- the audit scenarios submitted no product save; upload requests were intercepted;
- the isolated database retained the same exact eight canonical product slugs before and after the final gate;
- screenshots were opened and visually checked for nonblank rendering, visible actions, and clipping.

Evidence is retained outside the candidate Git tree under `.superpowers/release-four-lines-20261014/evidence/product-workbench/`, including the detailed audit record and checksummed screenshots.

Existing non-blocking runtime warnings were observed: `NO_COLOR` is ignored when `FORCE_COLOR` is set, and the PostgreSQL adapter emits a pg 9 deprecation warning. Neither warning produced a page error or failed assertion.

## Post-baseline differences

- Release B/Homepage Builder subsequently changed shared preview code. Its deployed `PreviewPane` still preserves the internal `data-preview-scroll`, `overflow-y-auto`, and `overscroll-contain` contract and passed the browser containment check.
- Product Card V2 now validates independent card covers. An exploratory run of historical write-heavy editor scenarios encountered that newer validation; those scenarios are not evidence for this no-write audit and no Product Card behavior was altered here.
- FAQ, Variant Dimensions/Packaging, and Bundle files remain outside this audit. Their donor differences are not Product Workbench omissions.

## Sign-off

The post-Release-B baseline already contains the approved Product Workbench/media functionality, with focused unit coverage and fresh real-browser evidence. Re-importing the historical patches would duplicate released code and risk overwriting later Release B, Product Card V2, FAQ, Phase 1, or Bundle changes.

**Release action: none. Wave 0 is accepted as a documentation-only no-op.**
