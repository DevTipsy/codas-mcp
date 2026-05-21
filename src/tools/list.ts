import { z } from "zod";
import type { CodasClient } from "../codasClient.js";
import { formatSummary } from "./search.js";

/**
 * Tool MCP : `list_components`
 *
 * Browse paginé du catalogue sans mots-clés. À utiliser pour répondre
 * aux questions naturelles type "donne-moi les composants populaires",
 * "liste les nouveaux", "les moins téléchargés", "ordre alphabétique"…
 *
 * Le tri est composé de deux paramètres orthogonaux :
 *  - `sort`   : sur quel critère trier (downloads, rating, date, name)
 *  - `order`  : sens du tri (asc / desc)
 *
 * Exemples d'usage :
 *  - "populaires"      → sort=downloads, order=desc
 *  - "moins téléchargés" → sort=downloads, order=asc
 *  - "nouveaux"         → sort=date, order=desc
 *  - "plus anciens"     → sort=date, order=asc
 *  - "mieux notés"      → sort=rating, order=desc
 *  - "moins bien notés" → sort=rating, order=asc
 *  - "ordre alphabétique" → sort=name, order=asc
 */

export const listComponentsSchema = {
  sort: z.enum(["downloads", "rating", "date", "name"]).default("downloads")
    .describe(
      "Critère de tri : 'downloads' (nombre de téléchargements / popularité), 'rating' (note moyenne), 'date' (date de publication), 'name' (alphabétique)."
    ),
  order: z.enum(["desc", "asc"]).default("desc")
    .describe(
      "Sens du tri : 'desc' (du plus haut au plus bas — populaires, mieux notés, plus récents) ou 'asc' (l'inverse). " +
      "Pour 'name', 'asc' = A→Z (défaut implicite si name)."
    ),
  categoryId: z.string().uuid().optional()
    .describe("Optionnel — filtre sur une catégorie spécifique."),
  limit: z.number().int().min(1).max(20).default(10)
    .describe("Nombre de résultats à retourner (1-20, défaut 10)."),
};

type SortKey = "downloads" | "rating" | "date" | "name";
type OrderKey = "desc" | "asc";

export async function listComponents(
  client: CodasClient,
  input: { sort?: SortKey; order?: OrderKey; categoryId?: string; limit?: number }
) {
  const sort: SortKey = input.sort ?? "downloads";
  // Pour 'name' on inverse le défaut : alphabétique = ascending naturellement.
  const order: OrderKey = input.order ?? (sort === "name" ? "asc" : "desc");

  const backendSort = {
    downloads: "downloadCount",
    rating:    "averageRating",
    date:      "createdAt",
    name:      "name",
  }[sort] as "downloadCount" | "averageRating" | "createdAt" | "name";

  const [page, ownedIds, categoriesMap] = await Promise.all([
    client.listComponents({
      sort: backendSort,
      order,
      categoryId: input.categoryId,
      per: input.limit ?? 10,
    }),
    client.getOwnedComponentIds(),
    client.getCategoriesMap(),
  ]);

  return {
    sort,
    order,
    total: page.metadata.total,
    returned: page.items.length,
    results: page.items.map((c) => formatSummary(c, ownedIds.has(c.id), categoriesMap)),
  };
}
