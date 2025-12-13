export const TOPIC_IMAGE_RULES = [
  { topicKey: "earthquake", pattern: /σεισμ/iu },
  { topicKey: "wildfire", pattern: /(πυρκαγ|φωτι(ά|α)|φλεγ)/iu },
  { topicKey: "car_crash", pattern: /(τροχαίο|τροχαιο|καραμπ(ό|o)λα|συγκρούσ)/iu },
  { topicKey: "court", pattern: /δικαστ/iu },
  { topicKey: "police", pattern: /(αστυνομ|ελ\.\s*ας|συλληψ|προσαγωγ)/iu },
  { topicKey: "severe_weather", pattern: /(κακοκαιρ|καταιγίδ|θύελλ|χιον|παγετ|πλημμυρ)/iu },
  { topicKey: "war", pattern: /(πόλεμος|πολεμ|επίθεση|συρραξ)/iu },
];
