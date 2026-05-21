import { z } from "zod";
import type { CodasClient } from "../codasClient.js";
import { formatSummary } from "./search.js";

/**
 * Tool MCP : `list_components`
 *
 * Browse paginé du catalogue sans mots-clés. Idéal pour répondre aux
 * questions naturelles type "donne-moi les composants populaires" /
 * "liste les nouveaux composants" / "trie par note" — la LLM choisit
 * juste `sort` au lieu d'essayer une recherche textuelle qui rate.
 */

const SortOption = z
  .enum(["popular", "new", "rating", "name"])
  .describe(
    "Critère de tri : 'popular' (top téléchargements), 'new' (plus récents), 'rating' (mieux notés), 'name' (alphabétique)."
  );

export const listComponentsSchema = {
  sort: SortOption.default("popular"),
  categoryId: z.string().uuid().optional()
    .describe("Optionnel — filtre sur une catégorie spécifique."),
  limit: z.number().int().min(1).max(20).default(10)
    .describe("Nombre de résultats à retourner (1-20, défaut 10)."),
};

export async function listComponents(
  client: CodasClient,
  input: { sort?: "popular" | "new" | "rating" | "name"; categoryId?: string; limit?: number }
) {
  const sortMap = {
    popular: { sort: "downloadCount" as const, order: "desc" as const },
    new:     { sort: "createdAt" as const,     order: "desc" as const },
    rating:  { sort: "averageRating" as const, order: "desc" as const },
    name:    { sort: "name" as const,          order: "asc" as const },
  };
  const { sort, order } = sortMap[input.sort ?? "popular"];

  const [page, ownedIds, categoriesMap] = await Promise.all([
    client.listComponents({
      sort,
      order,
      categoryId: input.categoryId,
      per: input.limit ?? 10,
    }),
    client.getOwnedComponentIds(),
    client.getCategoriesMap(),
  ]);

  return {
    sort: input.sort ?? "popular",
    total: page.metadata.total,
    returned: page.items.length,
    results: page.items.map((c) => formatSummary(c, ownedIds.has(c.id), categoriesMap)),
  };
}
