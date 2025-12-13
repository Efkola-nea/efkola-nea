// llm/imageRules.js
export const TOPIC_IMAGE_RULES = [
  { topicKey: "earthquake", match: /σεισμ/iu },
  { topicKey: "wildfire", match: /(πυρκαγ|φωτι(ά|α)|φλεγ)/iu },
  { topicKey: "car_crash", match: /(τροχαίο|τροχαιο|καραμπ(ό|o)λα|συγκρούσ)/iu },
  { topicKey: "court", match: /δικαστ/iu },
  { topicKey: "police", match: /(αστυνομ|ελ\.\s*ας|συλληψ|προσαγωγ)/iu },
  { topicKey: "severe_weather", match: /(κακοκαιρ|καταιγίδ|θύελλ|χιον|παγετ|πλημμυρ)/iu },
  { topicKey: "war", match: /(πόλεμος|πολεμ|επίθεση|συρραξ)/iu },
];

