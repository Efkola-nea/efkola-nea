import { ExtractorOutput, ValidatorOutput, WriterDraft } from "../src/types/schemas.js";

export const baseExtractorOutput: ExtractorOutput = {
  headline_from_source: "Νέο σχέδιο για καθαρότερη ενέργεια στην πόλη",
  main_topic: "Τοπικό πρόγραμμα για καθαρή ενέργεια",
  category_candidate: "local",
  summary_facts: [
    "Ο δήμος ανακοίνωσε πρόγραμμα για μείωση κατανάλωσης ενέργειας.",
    "Το σχέδιο ξεκινά τον Ιούνιο του 2026.",
  ],
  who: "Δήμος και τοπικές υπηρεσίες",
  what: "Πρόγραμμα εξοικονόμησης και αναβάθμισης φωτισμού",
  when: "Ιούνιος 2026",
  where: "Κεντρικές γειτονιές της πόλης",
  why: "Μείωση κόστους και λιγότερες εκπομπές",
  key_numbers: [
    { label: "Προϋπολογισμός", value: "5", context: "εκατ. ευρώ" },
    { label: "Διάρκεια", value: "18", context: "μήνες" },
  ],
  uncertainty_flags: [],
  sensitive_or_disturbing_content_flag: false,
  difficult_terms: [
    {
      term: "ενεργειακή αναβάθμιση",
      simple_explanation: "βελτίωση για χαμηλότερη κατανάλωση ενέργειας",
    },
  ],
  source_confidence_notes: "Η πηγή δίνει σαφές χρονοδιάγραμμα και ποσά.",
  should_publish_candidate: true,
  publish_reasoning_short: "Υπάρχουν σαφή στοιχεία και πρακτικό ενδιαφέρον.",
};

export const baseWriterDraft: WriterDraft = {
  title: "Νέο πρόγραμμα καθαρής ενέργειας στην πόλη",
  lead: "Ο δήμος ανακοίνωσε νέο σχέδιο για την ενέργεια. Το πρόγραμμα ξεκινά τον Ιούνιο του 2026.",
  paragraphs: [
    "Το σχέδιο αφορά κυρίως τον δημόσιο φωτισμό και δημοτικά κτίρια.",
    "Ο προϋπολογισμός φτάνει τα 5 εκατ. ευρώ και η διάρκεια είναι 18 μήνες.",
    "Στόχος είναι μικρότερο κόστος και λιγότερες εκπομπές.",
  ],
};

export const baseValidatorOutput: ValidatorOutput = {
  pass: true,
  scores: {
    fidelity: 5,
    simplicity: 4,
    readability: 4,
    naturalness: 4,
    policy_fit: 5,
  },
  violations: [],
  human_readable_feedback: ["Το κείμενο είναι σαφές και συνεπές με τα στοιχεία."],
  repair_instructions: ["Δεν απαιτείται αλλαγή."],
  must_retry_writer: false,
};
