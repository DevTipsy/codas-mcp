import { z } from "zod";
import { CodasClient, CodasAPIError } from "../codasClient.js";
import { priceLabel } from "./search.js";

/**
 * Tool MCP : `get_component`
 *
 * Récupère le détail d'un composant (code SwiftUI + instructions). Pour les
 * composants payants, vérifie que le user les a obtenus — sinon refuse de
 * livrer le code et oriente vers l'app pour l'achat.
 */
export const getComponentSchema = {
  id: z.string().uuid()
    .describe("UUID du composant (retourné par search_components ou recommend_component)."),
};

export async function getComponent(
  client: CodasClient,
  input: { id: string }
) {
  let component;
  try {
    component = await client.getComponent(input.id);
  } catch (err) {
    if (err instanceof CodasAPIError && err.status === 404) {
      throw new Error("Composant introuvable. Vérifie l'UUID.");
    }
    throw err;
  }

  const categoriesMap = await client.getCategoriesMap();
  const categoryName = categoriesMap.get(component.categoryId)?.name ?? "Inconnue";
  const author = `@${component.author?.alias ?? "inconnu"}`;

  // Vérification d'accès au code.
  if (component.priceTier !== "free") {
    const owned = await client.getOwnedComponentIds();
    if (!owned.has(component.id)) {
      return {
        accessGranted: false,
        id: component.id,
        name: component.name,
        description: component.description,
        author,
        category: categoryName,
        priceTier: component.priceTier,
        priceLabel: priceLabel(component.priceTier),
        message:
          `Ce composant est payant (${priceLabel(component.priceTier)}) et tu ne l'as pas encore obtenu. ` +
          `Pour l'acheter et débloquer le code, ouvre l'app Codas → Catégories → recherche "${component.name}" → bouton "Obtenir".`,
      };
    }
  }

  return {
    accessGranted: true,
    id: component.id,
    name: component.name,
    description: component.description,
    author,
    category: categoryName,
    priceTier: component.priceTier,
    priceLabel: priceLabel(component.priceTier),
    minIosVersion: component.minIosVersion ?? null,
    dependencies: component.dependencies ? [component.dependencies] : [],
    code: component.code ?? "",
    implementationInstructions: component.implementationInstructions ?? "",
  };
}
