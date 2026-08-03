import { useArchiveStore } from "@/lib/archive-store";
import { useCatalogStore } from "@/lib/catalog-store";
import { useDesignStore } from "@/lib/design-store";

/**
 * Everything the session holds, cleared in one call: the catalog and its
 * filters, every design opened, and the parametric designer. A demo that has to
 * be restarted mid-meeting should take one action, not a reload and a re-upload.
 */
export function resetDemo(): void {
  useCatalogStore.getState().reset();
  useArchiveStore.getState().clearAll();
  useDesignStore.getState().resetParams();
}
