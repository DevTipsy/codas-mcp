import { z } from "zod";
import type { CodasClient, Component } from "../codasClient.js";
import { formatSummary } from "./search.js";

/**
 * Tool MCP : `recommend_component`
 *
 * Prend un prompt en langage naturel (FR ou EN), extrait des mots-clés,
 * fait plusieurs recherches et score les résultats par pertinence.
 * Renvoie le top 5 — l'IA enchaîne avec `get_component(id)` sur celui qui
 * correspond le mieux au besoin de l'utilisateur.
 *
 * Approche MVP volontairement simple :
 *  - tokenisation/stopwords basique (FR + EN)
 *  - 1 requête /components?search=... par token significatif
 *  - score = nombre de matches (un composant qui matche 3 tokens > 1 token)
 *  - bonus si le composant est gratuit ou déjà obtenu (UX-friendly)
 *
 * Quand le catalogue grandira (>100 composants), on migrera vers des
 * embeddings vectoriels (OpenAI text-embedding-3-small).
 */

export const recommendComponentSchema = {
  prompt: z.string()
    .min(3)
    .describe(
      "Décris ton besoin en langage naturel (ex. 'j'ai besoin d'un bouton avec un effet de glow néon pour mon écran de login')."
    ),
  limit: z.number().int().min(1).max(10).default(5)
    .describe("Nombre max de recommandations (1-10, défaut 5)."),
};

// Stopwords FR + EN — assez courts pour rester maintenables, ratissent large.
const STOPWORDS = new Set([
  // FR
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "à", "au", "aux",
  "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "pour", "avec", "sans", "sur", "dans", "par", "qui", "que", "quoi", "dont", "où",
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
  "ai", "as", "a", "avons", "avez", "ont", "suis", "es", "est", "sommes", "êtes", "sont",
  "comme", "pas", "ne", "n", "y", "en", "plus", "très", "donc", "mais", "car",
  "besoin", "veux", "voudrais", "souhaite", "cherche", "trouve",
  // EN
  "the", "a", "an", "and", "or", "of", "to", "for", "with", "without", "on", "in",
  "this", "that", "these", "those", "my", "your", "his", "her", "our", "their",
  "i", "you", "he", "she", "we", "they", "it",
  "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "can", "may", "might",
  "want", "need", "looking", "find",
]);

export async function recommendComponent(
  client: CodasClient,
  input: { prompt: string; limit?: number }
) {
  const tokens = tokenize(input.prompt);
  if (tokens.length === 0) {
    return { results: [], message: "Prompt trop générique — précise quel type de composant tu cherches." };
  }

  // 1 fetch par token (parallèle), max 20 composants par token.
  const perToken = await Promise.all(
    tokens.map((t) =>
      client.listComponents({ search: t, per: 20, sort: "downloadCount", order: "desc" })
        .then((page) => ({ token: t, items: page.items }))
        .catch(() => ({ token: t, items: [] as Component[] }))
    )
  );

  // Scoring : on agrège par component id, +1 par token qui matche.
  const scored = new Map<string, { component: Component; score: number; matched: string[] }>();
  for (const { token, items } of perToken) {
    for (const c of items) {
      const entry = scored.get(c.id);
      if (entry) {
        entry.score += 1;
        entry.matched.push(token);
      } else {
        scored.set(c.id, { component: c, score: 1, matched: [token] });
      }
    }
  }

  if (scored.size === 0) {
    return {
      results: [],
      message: "Aucun composant ne matche ces mots-clés. Essaie une formulation différente (ex. nom de catégorie : bouton, card, navigation, formulaire...).",
    };
  }

  const [ownedIds, categoriesMap] = await Promise.all([
    client.getOwnedComponentIds(),
    client.getCategoriesMap(),
  ]);

  // Tri : score d'abord, puis composants accessibles (gratuit ou obtenus)
  // remontent, puis downloadCount comme tiebreaker.
  const ranked = [...scored.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aAccessible = a.component.priceTier === "free" || ownedIds.has(a.component.id);
    const bAccessible = b.component.priceTier === "free" || ownedIds.has(b.component.id);
    if (aAccessible !== bAccessible) return aAccessible ? -1 : 1;
    return (b.component.downloadCount ?? 0) - (a.component.downloadCount ?? 0);
  });

  const top = ranked.slice(0, input.limit ?? 5);

  return {
    results: top.map(({ component, score, matched }) => ({
      ...formatSummary(component, ownedIds.has(component.id), categoriesMap),
      matchScore: score,
      matchedKeywords: matched,
    })),
    matchedTokens: tokens,
  };
}

// ---------- Tokenisation ----------

function tokenize(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")               // strip accents
    .replace(/[^a-z0-9\s-]/g, " ")                 // garde lettres + chiffres + tirets
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .slice(0, 8);                                  // 8 tokens max → 8 requêtes max
}
