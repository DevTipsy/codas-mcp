# Codas MCP

Serveur [MCP](https://modelcontextprotocol.io) qui connecte Claude Code, Cursor, ChatGPT et autres assistants IA au catalogue de composants SwiftUI de [Codas](https://codaslibrary.app).

Une fois branché, l'IA peut :
- chercher des composants par mots-clés ;
- recommander un composant à partir d'un besoin en langage naturel ;
- récupérer le code SwiftUI complet d'un composant gratuit ou que tu as déjà obtenu.

> Le serveur est hébergé par Codas sur `https://mcp.codaslibrary.app`. Pas besoin d'installer quoi que ce soit côté serveur — il suffit de coller ta clé API dans la config de ton client IA.

## Utilisation

### 1. Génère une clé API

Dans l'app Codas (iOS / iPadOS / macOS) → **Profil → Clés API → Générer**. Tu verras la clé une seule fois ; copie-la.

### 2. Branche-la dans ton client IA

#### Claude Code

```bash
claude mcp add codas https://mcp.codaslibrary.app/mcp \
  --transport http \
  --header "Authorization: Bearer codas_pk_xxx"
```

#### Cursor / Windsurf / ChatGPT Desktop / Zed

Voir les snippets de config détaillés sur **[codaslibrary.app/mcp](https://codaslibrary.app/mcp.html)**.

### 3. Demande à ton IA

> *« Trouve-moi un bouton avec un effet glass dans Codas »*
> *« Recommande un composant pour faire un graphique »*

Elle appellera automatiquement les outils Codas et te restituera le code prêt à coller.

## Tools exposés

| Tool | Description |
|---|---|
| `search_components` | Recherche par mots-clés (multi-mots tokenisés). Retourne les métadonnées, pas le code. |
| `get_component` | Code SwiftUI + instructions d'intégration + dépendances. Refuse les payants non obtenus. |
| `recommend_component` | À partir d'un besoin en langage naturel, top 5 composants pertinents. |

## Transparence

Le code source est publié pour que tu puisses **auditer ce qui est fait de ta clé API**. Aucune information de ton projet local n'est transmise au serveur, uniquement les paramètres explicites des tools (mots-clés de recherche, UUIDs de composants).

Une seule instance officielle du serveur est maintenue par Codas. **Ce repo n'accepte pas les contributions externes ni les forks à but de redistribution.**
