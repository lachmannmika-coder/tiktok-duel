// Zentrale Konstanten fuer das Follower-Duell-Dashboard. Laeuft als klassisches
// Browser-Script (haengt sich an window.DUELL_CONFIG) UND als CommonJS-Modul (fuer Tests).
(function (root, factory) {
  const cfg = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = cfg;
  else root.DUELL_CONFIG = cfg;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return {
    // Farben je Creator (Identitaet bleibt erhalten): Mika = Champagner-Gold, Tino = Platin/Stahl.
    colors: {
      a: "#d4af6e",
      aDeep: "#8a6d3a",
      b: "#aeb6c2",
      bDeep: "#5c6672",
      muted: "#8a90a4",
      green: "#3ddc84"
    },

    // Zentrale Score-Formel des Duells: Punkte = Follower-Zuwachs*3 + Likes-Zuwachs*1 + neue Videos*2.
    // logic.js bekommt diese Gewichte immer als Parameter gereicht (kein Hardcoding dort).
    scoring: { followers: 3, likes: 1, videos: 2 },

    // Daten-Update laeuft taeglich (siehe .github/workflows/daily.yml).
    updateUtcHour: 6
  };
});
