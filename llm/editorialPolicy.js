const HARD_BLOCK_KEYWORDS = [
  // English
  "murder",
  "homicide",
  "kill",
  "death",
  "dead",
  "fatal",
  "accident",
  "crash",
  "war",
  "bomb",
  "suicide",
  "rape",
  "abuse",
  "terror",
  "terrorist",
  "massacre",
  "shooting",
  "explosion",
  "hostage",
  "kidnapping",
  "assault",
  "stab",
  "corpse",
  "funeral",
  "tragedy",
  "torture",
  "execution",
  "executed",
  "martyr",
  "femicide",
  "missile",
  "invasion",
  "genocide",
  // Greek stems / variants
  "δολοφον",
  "γυναικοκτον",
  "φονος",
  "θανατ",
  "νεκρ",
  "σκοτω",
  "τροχαιο",
  "δυστυχημ",
  "πολεμ",
  "βομβ",
  "αυτοκτον",
  "βιασμ",
  "κακοποι",
  "τρομοκρατ",
  "μακελει",
  "πυροβολ",
  "εκρηξ",
  "ομηρ",
  "απαγωγ",
  "επιθεσ",
  "μαχαιρ",
  "αιμα",
  "πτωμ",
  "κηδει",
  "τραγωδι",
  "βασανισ",
  "εκτελεσ",
  "μαρτυρ",
  "πυραυλ",
  "εισβολ",
  "γενοκτον",
];

const PRACTICAL_SERIOUS_KEYWORDS = [
  "καιρ",
  "δρομολογ",
  "μετρο",
  "ησαπ",
  "τραμ",
  "λεωφορει",
  "κυκλοφορ",
  "κινηση",
  "δρομο",
  "μετακινησ",
  "σχολ",
  "πανεπιστη",
  "εκπαιδευσ",
  "υγεια",
  "νοσοκομ",
  "φαρμακ",
  "εμβολ",
  "ιατρ",
  "υπηρεσι",
  "δημο",
  "κοινοτ",
  "τοπικ",
  "δημοτικ",
  "πλατφορμ",
  "αιτησ",
  "προθεσμι",
  "πληρωμ",
  "επιδομ",
  "συνταξ",
  "efka",
  "εφκα",
  "dypa",
  "δυπα",
  "εργασι",
  "μισθ",
  "λογαριασμ",
  "αγορα",
  "τιμολογ",
  "τιμη",
  "ενεργει",
  "ρευμα",
  "νερ",
  "κατοικ",
  "στεγασ",
  "προγραμμα",
  "εξυπηρετ",
  "δημοσια διοικηση",
  "πολιτη",
];

const LIGHT_EDITORIAL_KEYWORDS = [
  "συναυλι",
  "μουσικ",
  "θεατρ",
  "παραστασ",
  "φεστιβ",
  "εκθεσ",
  "μουσει",
  "ταινι",
  "σινεμ",
  "κινηματογρ",
  "σειρ",
  "streaming",
  "netflix",
  "βολτ",
  "εκδηλωσ",
  "διασκεδασ",
  "ταξιδ",
  "καφε",
  "εστιατορ",
  "αθλητ",
  "πρωταθλημ",
  "αγων",
  "ανθρωπιν",
  "εθελοντ",
  "βραβει",
  "θετικ",
  "χαρουμεν",
];

const HEAVY_ABSTRACT_KEYWORDS = [
  "γεωπολιτ",
  "διπλωματ",
  "αντιπαραθεσ",
  "κομματ",
  "δικαστ",
  "σκανδαλ",
  "καταγγελι",
  "εντασ",
  "συγκρουσ",
  "στρατιωτ",
  "κυρωσ",
];

function normalizeForKeywordMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueKeywordMatches(text, keywords) {
  const normalized = normalizeForKeywordMatch(text);
  if (!normalized) return [];

  const words = normalized.split(" ").filter(Boolean);
  const matches = [];

  for (const rawKeyword of keywords) {
    const keyword = normalizeForKeywordMatch(rawKeyword);
    if (!keyword) continue;

    const matched = keyword.includes(" ")
      ? normalized.includes(keyword)
      : words.some((word) => word === keyword || word.startsWith(keyword));

    if (matched) matches.push(keyword);
  }

  return [...new Set(matches)];
}

function hasKeywordMatch(text, keywords) {
  return uniqueKeywordMatches(text, keywords).length > 0;
}

function shouldSkipArticle(title, description) {
  return hasKeywordMatch(`${title || ""} ${description || ""}`, HARD_BLOCK_KEYWORDS);
}

function editorialPriorityScoreText(text, { categoryHints = [] } = {}) {
  const practicalHits = uniqueKeywordMatches(text, PRACTICAL_SERIOUS_KEYWORDS).length;
  const lightHits = uniqueKeywordMatches(text, LIGHT_EDITORIAL_KEYWORDS).length;
  const heavyHits = uniqueKeywordMatches(text, HEAVY_ABSTRACT_KEYWORDS).length;
  const hardBlocked = hasKeywordMatch(text, HARD_BLOCK_KEYWORDS);

  let score = practicalHits * 4 + lightHits * 3 - heavyHits * 4;

  for (const hint of categoryHints) {
    if (["happy", "screen", "culture", "fun", "sports"].includes(hint)) {
      score += 3;
    } else if (hint === "serious") {
      score += 1;
    }
  }

  if (hardBlocked) score -= 20;
  return score;
}

function isUsefulSeriousText(title, text = "") {
  const combined = `${title || ""} ${text || ""}`.trim();
  if (!combined) return false;
  if (hasKeywordMatch(combined, HARD_BLOCK_KEYWORDS)) return false;

  const practicalHits = uniqueKeywordMatches(combined, PRACTICAL_SERIOUS_KEYWORDS).length;
  const heavyHits = uniqueKeywordMatches(combined, HEAVY_ABSTRACT_KEYWORDS).length;

  return practicalHits > 0 && practicalHits >= heavyHits;
}

export {
  HARD_BLOCK_KEYWORDS,
  HEAVY_ABSTRACT_KEYWORDS,
  LIGHT_EDITORIAL_KEYWORDS,
  PRACTICAL_SERIOUS_KEYWORDS,
  editorialPriorityScoreText,
  hasKeywordMatch,
  isUsefulSeriousText,
  normalizeForKeywordMatch,
  shouldSkipArticle,
  uniqueKeywordMatches,
};
