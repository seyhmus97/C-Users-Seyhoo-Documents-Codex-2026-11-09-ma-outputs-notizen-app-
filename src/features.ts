// features.ts – Edition der App.
// „full“ (Standard): mit Lerngruppen und Gruppenchat.
// „solo“: ohne Lerngruppen und ohne Gruppenchat – nur persönliche Notizen, PDFs und Labor.
// Gesteuert über den Vite-Modus (solo / native-solo, siehe vite.config.ts und die *:solo-Skripte in package.json).
export const EDITION: "full" | "solo" = import.meta.env.VITE_XNTS_EDITION === "solo" ? "solo" : "full";
export const GROUPS_ENABLED = EDITION === "full";
