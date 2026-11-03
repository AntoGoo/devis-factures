import { z } from 'zod';

// Zod compile ses validations d'objets avec `new Function` s'il le peut, et le vérifie en en créant une. La CSP
// (script-src 'self', sans 'unsafe-eval') l'interdit : l'essai échoue sans casser Zod, mais le navigateur signale une
// violation CSP à chaque chargement. Le mode jitless supprime cet essai. Importé en premier par main.tsx.
z.config({ jitless: true });
