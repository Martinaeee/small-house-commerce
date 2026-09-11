import { describe, expect, it } from 'vitest';
import { expandCategoryIds, type CategoryTreeEdge } from './category-tree.js';

const rows: CategoryTreeEdge[] = [
  { id: 'root', parentId: null },
  { id: 'a', parentId: 'root' },
  { id: 'b', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
  { id: 'a1x', parentId: 'a1' },
  { id: 'orphan', parentId: 'missing-parent' },
];

describe('expandCategoryIds', () => {
  it('returns the id plus every descendant for a root', () => {
    expect(expandCategoryIds(rows, 'root').sort()).toEqual(
      ['root', 'a', 'b', 'a1', 'a2', 'a1x'].sort(),
    );
  });

  it('returns the id plus its subtree for a mid-level category', () => {
    expect(expandCategoryIds(rows, 'a').sort()).toEqual(['a', 'a1', 'a2', 'a1x'].sort());
  });

  it('returns just the id for a leaf', () => {
    expect(expandCategoryIds(rows, 'a1x')).toEqual(['a1x']);
  });

  it('always includes the queried id even when it is absent from the rows', () => {
    expect(expandCategoryIds(rows, 'unknown')).toEqual(['unknown']);
  });

  it('does not traverse a parent whose row was filtered out (inactive branch)', () => {
    const activeOnly = rows.filter((row) => row.id !== 'a1');
    // a1 gone → a1x cannot be reached through the tree, but 'a' itself remains.
    expect(expandCategoryIds(activeOnly, 'root').sort()).toEqual(['root', 'a', 'b', 'a2'].sort());
  });
});
