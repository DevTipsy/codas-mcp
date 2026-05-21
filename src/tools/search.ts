import { z } from "zod";
import type { CodasClient, Component, Category } from "../codasClient.js";

/**
 * Tool MCP : `search_components`
 *
 * Recherche dans le catalogue par mots-clés. Si l'IA envoie une phrase
 * multi-mots, on tokenise et on aggrège les résultats par fréquence de match
 * (sinon le backend ferait du LIKE %phrase complète% qui rate quasi tout).
 *
 * Retourne metadata uniquement (pas le code) — pour récupérer le code,
 * l'IA enchaîne avec `get_component(id)`.
 */
export const searchComponentsSchema = {
  query: z.string()
    .min(1)
    .describe(
      "Mots-clés à chercher (ex. 'bouton', 'glass', 'searchbar'). " +
      "Si tu passes une phrase multi-mots, on tokenise automatiquement et on cherche chaque mot indépendamment."
    ),
  categoryId: z.string().uuid().optional()
    .describe("Optionnel — filtre sur une catégorie spécifique."),
  limit: z.number().int().min(1).max(20).default(10)
    .describe("Nombre max de résultats (1-20, défaut 10)."),
};

export async function searchComponents(
  client: CodasClient,
  input: { query: string; categoryId?: string; limit?: number }
) {
  // Tokenisation : on découpe en mots ≥3 caractères. Si y'en a qu'un, c'est
  // une recherche directe. Si y'en a plusieurs, on cherche chaque token puis
  // on aggrège par fréquence.
  const tokens = tokenizeQuery(input.query);
  if (tokens.length === 0) {
    return { total: 0, returned: 0, results: [], message: "Query vide ou trop courte." };
  }

  const limit = input.limit ?? 10;
  const [categoriesMap, ownedIds] = await Promise.all([
    client.getCategoriesMap(),
    client.getOwnedComponentIds(),
  ]);

  // Lance N requêtes en parallèle (max 8 tokens via tokenizeQuery).
  const pages = await Promise.all(
    tokens.map((t) =>
      client.listComponents({
        search: t,
        categoryId: input.categoryId,
        per: 20,
        sort: "downloadCount",
        order: "desc",
      }).catch(() => ({ items: [] as Component[], metadata: { page: 1, per: 20, total: 0 } }))
    )
  );

  // Aggrège : score = nombre de tokens qui matchent ce composant.
  const scored = new Map<string, { component: Component; score: number }>();
  for (const page of pages) {
    for (const c of page.items) {
      const entry = scored.get(c.id);
      if (entry) entry.score += 1;
      else scored.set(c.id, { component: c, score: 1 });
    }
  }

  const ranked = [...scored.values()]
    .sort((a, b) => b.score - a.score || (b.component.downloadCount ?? 0) - (a.component.downloadCount ?? 0))
    .slice(0, limit);

  return {
    total: scored.size,
    returned: ranked.length,
    results: ranked.map(({ component }) => formatSummary(component, ownedIds.has(component.id), categoriesMap)),
  };
}

// ---------- Helpers ----------

/**
 * Formate un composant pour le retour MCP — version "résumé" sans le code.
 * `id` est nécessaire pour l'enchaînement avec get_component(id), même s'il
 * n'est pas destiné à être montré à l'utilisateur final.
 */
export function formatSummary(
  c: Component,
  isObtained: boolean,
  categoriesMap?: Map<string, Category>
) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    author: `@${c.author?.alias ?? "inconnu"}`,
    category: categoriesMap?.get(c.categoryId)?.name ?? "Inconnue",
    priceTier: c.priceTier,
    priceLabel: priceLabel(c.priceTier),
    isObtained: c.priceTier === "free" ? true : isObtained,
    averageRating: c.averageRating ?? null,
    ratingsCount: c.ratingsCount ?? 0,
    downloadCount: c.downloadCount ?? 0,
  };
}

const SHORT_STOPWORDS = new Set([
  "the", "and", "for", "with", "que", "les", "des", "une", "pour", "avec", "sur",
  "dans", "par", "qui", "swiftui", "composant", "composants", "ios", "code",
]);

function tokenizeQuery(query: string): string[] {
  const cleaned = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 3 && !SHORT_STOPWORDS.has(t));
  return tokens.slice(0, 8);
}

export function priceLabel(tier: string): string {
  switch (tier) {
    case "free":  return "Gratuit";
    case "tier1": return "0,99 €";
    case "tier2": return "1,99 €";
    case "tier3": return "2,99 €";
    case "tier4": return "3,99 €";
    case "tier5": return "8,99 €";
    default:      return tier;
  }
}
