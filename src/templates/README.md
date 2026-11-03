# Modèles visuels

Chaque modèle vit dans `src/templates/<id>/v<version>/` et fournit trois fichiers :

- `meta.ts` : `export const meta: TemplateMeta` (id, version, nom, description, ordre d'affichage) ;
- `index.tsx` : `export default` un `TemplateModule` (classe CSS racine, libellés, URL Google Fonts, vignette) ;
- `style.css` : styles du document, tous préfixés par la classe racine (`.tpl-<id>-v<version>`).

Le registre et le catalogue les découvrent avec `import.meta.glob` : **ajouter un modèle ne demande de modifier aucun autre fichier**.

Règle de versionnage : un modèle publié n'est jamais modifié. Pour le faire évoluer, copier `v1/` en `v2/`, changer `version` dans `meta.ts` et la classe racine, puis retoucher `v2/`. Les documents figés gardent la référence `modele-XX@1` de leur instantané et s'affichent toujours avec `v1/`. Seule la dernière version de chaque modèle est proposée au choix.
