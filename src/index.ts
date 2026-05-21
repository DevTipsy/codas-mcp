/**
 * Codas MCP server — entrée principale.
 *
 * Expose 3 tools (search, get, recommend) via le transport Streamable HTTP
 * de MCP. L'authentification se fait via la clé API personnelle de
 * l'utilisateur, transmise dans le header Authorization de chaque requête.
 *
 * Architecture :
 *  - 1 instance Express qui gère le routing HTTP
 *  - 1 instance MCPServer par requête (stateless) — instanciée à chaque
 *    appel POST /mcp, on extrait la clé API du header, on enregistre les
 *    tools avec un CodasClient associé, on délègue au transport, puis on
 *    nettoie.
 *
 * Ce mode "stateless" est recommandé par le SDK pour les serveurs hostés
 * multi-tenants : pas de session à maintenir entre requêtes, chaque appel
 * porte sa propre auth, scaling horizontal trivial.
 */

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { CodasClient } from "./codasClient.js";
import { searchComponents, searchComponentsSchema } from "./tools/search.js";
import { getComponent, getComponentSchema } from "./tools/getComponent.js";
import { recommendComponent, recommendComponentSchema } from "./tools/recommend.js";

const PORT = Number(process.env.PORT ?? 8081);
const app = express();
app.use(express.json({ limit: "1mb" }));

// Healthcheck (utile pour nginx / monitoring).
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "codas-mcp", version: "0.1.0" });
});

/**
 * Point d'entrée MCP. Le client envoie un POST avec :
 *  - body = message JSON-RPC
 *  - header Authorization = Bearer codas_pk_xxx (la clé API user)
 *
 * On crée un McpServer ad hoc pour cette requête, on enregistre les tools
 * câblés sur la clé du caller, puis on laisse le transport répondre.
 */
app.post("/mcp", async (req: Request, res: Response) => {
  // 1. Extraction de la clé API
  const apiKey = extractBearer(req.headers.authorization);
  if (!apiKey || !apiKey.startsWith("codas_pk_")) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Clé API Codas manquante ou invalide. Génère une clé dans l'app Codas → Profil → Clés API, puis ajoute-la dans la config de ton client MCP : `Authorization: Bearer codas_pk_xxx`.",
      },
      id: null,
    });
    return;
  }

  // 2. Création d'un serveur MCP éphémère pour cette requête
  const client = new CodasClient({ apiKey });
  const server = createCodasServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless : pas de session persistante
  });

  // Nettoyage à la fin du flux
  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[/mcp] Erreur :", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Erreur interne du serveur MCP." },
        id: null,
      });
    }
  }
});

// Méthodes inutiles en mode stateless mais le protocole les exige côté client.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed — utilise POST." },
    id: null,
  });
});
app.delete("/mcp", (_req, res) => res.status(405).end());

app.listen(PORT, () => {
  console.log(`✅ Codas MCP server listening on http://0.0.0.0:${PORT}`);
});

// ---------- Helpers ----------

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

function createCodasServer(client: CodasClient): McpServer {
  const server = new McpServer(
    { name: "codas", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Codas est une bibliothèque communautaire de composants SwiftUI. " +
        "Utilise search_components pour découvrir, recommend_component pour partir d'un besoin naturel, " +
        "et get_component pour récupérer le code à intégrer dans le projet de l'utilisateur. " +
        "Les composants payants nécessitent un achat préalable dans l'app iOS — " +
        "si l'utilisateur n'a pas accès, oriente-le vers l'app au lieu d'insister.",
    }
  );

  // --- Tool 1 : search_components ---
  server.registerTool(
    "search_components",
    {
      title: "Rechercher des composants",
      description:
        "Cherche des composants SwiftUI dans le catalogue Codas par mots-clés " +
        "(nom et description). Retourne uniquement les métadonnées — pour le code, " +
        "enchaîne avec get_component(id).",
      inputSchema: searchComponentsSchema,
    },
    async (args) => {
      const result = await searchComponents(client, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool 2 : get_component ---
  server.registerTool(
    "get_component",
    {
      title: "Récupérer un composant",
      description:
        "Récupère le détail complet d'un composant : code SwiftUI + instructions " +
        "d'intégration + dépendances. Pour les composants payants, retourne accessGranted=false " +
        "si l'utilisateur ne les a pas obtenus — oriente-le alors vers l'app Codas pour l'achat.",
      inputSchema: getComponentSchema,
    },
    async (args) => {
      const result = await getComponent(client, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool 3 : recommend_component ---
  server.registerTool(
    "recommend_component",
    {
      title: "Recommander un composant",
      description:
        "Prend un besoin en langage naturel (FR ou EN), extrait des mots-clés et propose " +
        "le top 5 composants les plus pertinents avec un score de match. Utile quand " +
        "l'utilisateur décrit ce qu'il veut sans connaître le nom exact.",
      inputSchema: recommendComponentSchema,
    },
    async (args) => {
      const result = await recommendComponent(client, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}
