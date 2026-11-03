// Mentions obligatoires, vérifiées le 2026-11-03 sur :
// - https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045035275 (art. 293 B du CGI)
// - https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276 (art. 242 nonies A de l'annexe II au CGI)
// - https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392 (art. L441-10 du Code de commerce)
// - https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043197457 (art. D441-5 du Code de commerce)
// - https://entreprendre.service-public.gouv.fr/vosdroits/F31808 (mentions obligatoires d'une facture)
// - https://entreprendre.service-public.gouv.fr/vosdroits/F23266 (obligations du micro-entrepreneur, mention « EI »)
//
// Constat : au 2026-11-03, la mention « TVA non applicable, art. 293 B du CGI » reste la
// formulation en vigueur ; son remplacement par une référence au code des impôts sur les
// biens et services (CIBS) a été reporté au 1er janvier 2027, l'ancienne mention restant
// tolérée jusqu'au 30 juin 2028 — aucun changement à apporter en V1. L'indemnité forfaitaire
// de recouvrement est fixée à 40 € par l'art. D441-5 et n'est due que par un client
// professionnel (art. L441-10). La mention « EI » (ou « Entrepreneur individuel ») doit
// accompagner le nom de l'entrepreneur individuel sur tous ses documents commerciaux.

export const VAT_FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI';
export const NO_DISCOUNT_MENTION = 'Pas d’escompte pour paiement anticipé.';
export const RECOVERY_INDEMNITY_MENTION = 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.';
export const EI_SUFFIX = 'EI';
