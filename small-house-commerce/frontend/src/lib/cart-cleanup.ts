import { ApiError } from "./api";

/**
 * Removes cart lines one by one and returns the ids that could not be removed.
 *
 * A 404 means the line is already gone, which is what a retry after a partial
 * failure needs: the second attempt must be able to converge instead of
 * failing forever on the lines it already removed. Every other error stays a
 * failure so the caller can retry the remaining lines.
 */
export async function removeCartLines(
  removeLine: (itemId: string) => Promise<unknown>,
  itemIds: readonly string[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const itemId of itemIds) {
    try {
      await removeLine(itemId);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        failed.push(itemId);
      }
    }
  }
  return failed;
}
