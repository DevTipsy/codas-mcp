/**
 * Thin wrapper autour de l'API REST Vapor de Codas.
 *
 * Toutes les requêtes utilisent la clé API personnelle du user
 * (Authorization: Bearer codas_pk_xxx), récupérée depuis le header HTTP
 * envoyé par le client MCP au moment de l'appel d'un tool.
 */

const DEFAULT_BASE_URL = process.env.CODAS_API_BASE_URL ?? "http://89.168.55.247:8080";

// ---------- Types (alignés sur les DTO Vapor) ----------

export interface Author {
  id: string;
  alias: string;
}

export interface Component {
  id: string;
  name: string;
  description: string;
  /** Code SwiftUI complet — présent uniquement sur GET /:id, pas dans la liste. */
  code?: string;
  /** Instructions d'intégration — idem. */
  implementationInstructions?: string;
  /** Dans le DTO Vapor c'est une string opaque (peut être null). */
  dependencies?: string | null;
  minIosVersion?: string | null;
  /** "free" | "tier1" | "tier2" | "tier3" | "tier4" | "tier5" */
  priceTier: string;
  /** ⚠️ Vapor ne renvoie pas l'objet category, juste l'UUID. Le nom est
   *  résolu côté MCP via getCategoriesMap(). */
  categoryId: string;
  author: Author;
  downloadCount?: number;
  averageRating?: number;
  ratingsCount?: number;
  isNew?: boolean;
  isPopular?: boolean;
  createdAt?: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  displayOrder?: number;
}

interface Page<T> {
  items: T[];
  metadata: { page: number; per: number; total: number };
}

// ---------- Erreur typée ----------

export class CodasAPIError extends Error {
  constructor(public status: number, public reason: string) {
    super(`Codas API ${status}: ${reason}`);
    this.name = "CodasAPIError";
  }
}

// ---------- Client ----------

export interface CodasClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class CodasClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /** Cache des catégories — chargé à la première demande, partagé pour toute la
   *  durée de vie du client (qui est éphémère, recréé à chaque requête MCP). */
  private categoriesMap?: Map<string, Category>;

  constructor(opts: CodasClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  /** GET /categories — cached. Sert à résoudre categoryId → nom lisible. */
  async getCategoriesMap(): Promise<Map<string, Category>> {
    if (this.categoriesMap) return this.categoriesMap;
    const cats = await this.request<Category[]>(`/categories`);
    this.categoriesMap = new Map(cats.map((c) => [c.id, c]));
    return this.categoriesMap;
  }

  /** GET /components avec params de recherche/filtrage/pagination. */
  async listComponents(params: {
    search?: string;
    categoryId?: string;
    sort?: "createdAt" | "name" | "downloadCount" | "averageRating";
    order?: "asc" | "desc";
    per?: number;
    page?: number;
  }): Promise<Page<Component>> {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.categoryId) qs.set("categoryId", params.categoryId);
    qs.set("sort", params.sort ?? "createdAt");
    qs.set("order", params.order ?? "desc");
    qs.set("per", String(params.per ?? 20));
    qs.set("page", String(params.page ?? 1));
    return this.request<Page<Component>>(`/components?${qs}`);
  }

  /** GET /components/:id — code + instructions inclus. */
  async getComponent(id: string): Promise<Component> {
    return this.request<Component>(`/components/${id}`);
  }

  /** GET /purchases/obtained — IDs des composants payants déjà obtenus. */
  async getOwnedComponentIds(): Promise<Set<string>> {
    try {
      const owned = await this.request<string[]>(`/purchases/obtained`);
      return new Set(owned);
    } catch (err) {
      // En cas de pépin (route absente, etc.), on dégrade gracieusement :
      // isObtained=false pour les payants, l'IA suggérera l'achat.
      if (err instanceof CodasAPIError && err.status === 404) return new Set();
      throw err;
    }
  }

  // ---------- Bas niveau ----------

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { reason?: string };
        if (body.reason) reason = body.reason;
      } catch {
        /* ignore */
      }
      throw new CodasAPIError(res.status, reason);
    }
    const raw = (await res.json()) as unknown;
    // Vapor sérialise en snake_case via ContentConfiguration. Côté TS on
    // veut du camelCase → conversion récursive systématique.
    return snakeToCamelDeep(raw) as T;
  }
}

// ---------- Helpers ----------

/** Convertit récursivement les clés snake_case en camelCase. Préserve
 *  les valeurs primitives et la structure imbriquée (arrays, objects). */
function snakeToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamelDeep);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    out[camelKey] = snakeToCamelDeep(val);
  }
  return out;
}
