const mongoose = require('mongoose');
const { Schema } = mongoose;

const EffectSchema = new Schema({
  type:        { type: String, required: true },   // e.g. 'Stats Up', 'Guard', 'Freeze', .
  target:      { type: String, default: null },    // null or one of: attackPower, physicalPower, supernaturalPower, durability, speed
  power:       { type: Number, default: 0 },
  precedence:  { type: Number, default: 0 },
  remaining:   { type: Number, default: 0 },       // turns left
}, { _id: false });

// On-field multi-hit persistence
const FieldCardSchema = new mongoose.Schema({
  instanceId:     { type: String, required: true },
  card:           { type: mongoose.Schema.Types.Mixed, required: true }, // snapshot
  owner:          { type: String, enum: ['player','enemy'], required: false },
  turnsRemaining: { type: Number, min: 0, required: true },
  link:           { type: String, default: 'attack' },   // what it’s repeating
  scheduleState:  { type: Object, default: {} },         // runtime state for random/list schedules
}, { _id: false });

const Any = Schema.Types.Mixed;

// progress tracker (generator output or fixed path)
const ProgressSchema = new Schema({
  campaignId:   { type: Schema.Types.ObjectId, ref: 'Campaign' },
  roomIndex:    { type: Number, default: 0 },
  generatedPath:{ type: [Any], default: [] }, // frozen DTOs from /generate OR populated roomSequence
}, { _id: false });

// Run-only additive deck entries (do NOT alter campaign starting deck)
const ExtraDeckEntrySchema = new Schema({
  cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
  qty:    { type: Number, default: 1, min: 1, max: 30 }
}, { _id: false });

// Run-only additive stat deltas (allow negatives; no clamping)
const ExtraStatsSchema = new Schema({
  attackPower:        { type: Number, default: 0 },
  physicalPower:      { type: Number, default: 0 },
  supernaturalPower:  { type: Number, default: 0 },
  durability:         { type: Number, default: 0 },
  vitality:           { type: Number, default: 0 },
  intelligence:       { type: Number, default: 0 },
  speed:              { type: Number, default: 0 },
  sp:                 { type: Number, default: 0 },
  maxSp:              { type: Number, default: 0 },
  // Optional: additive HP delta (kept separate from vitality-based derivation)
  hp:                 { type: Number, default: 0 },
}, { _id: false });

const savedGameSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // DEPRECATED single-actor state (kept for backward compatibility during migration)
  playerStats:   { type: Any, required: false, default: undefined },
  deck:          { type: [Any], required: false, default: undefined },
  hand:          { type: [Any], required: false, default: undefined },
  discardPile:   { type: [Any], required: false, default: undefined },
  selectedCards: { type: [Any], required: true, default: [] },

  enemy: {
    id:     { type: Schema.Types.ObjectId, ref: 'Enemy', required: false },
    stats:  { type: Any, default: {} },   // baseline stats snapshot (optional)
    hp:     { type: Number, default: 0 },
    sp:     { type: Number, default: 0 },
    maxSp:  { type: Number, default: 0 },
  },
  enemyDeck:     { type: [Any], default: undefined },
  enemyHand:     { type: [Any], default: undefined },
  enemyDiscard:  { type: [Any], default: undefined },

  // Persistent effects (durations tick each full round in the controller)
  // DEPRECATED: side-level buckets; keep until controllers fully migrated
  activeEffects: {
    player: { type: [EffectSchema], default: [] },
    enemy:  { type: [EffectSchema], default: [] },
  },

  // Cards "on the field" from multi-hit scheduling
  onField: {
    player: { type: [FieldCardSchema], default: [] },
    enemy:  { type: [FieldCardSchema], default: [] }
  },

  // Run/campaign progression (legacy/simple)
  campaign:  { type: [Any], required: true, default: [] },
  roomIndex: { type: Number, required: true, default: 0 },
  gold:      { type: Number, required: true, default: 0 },

  // ==== NEW: campaign progress & roster/decks (additive; does not replace legacy fields) ====
  money:   { type: Number, default: 0 }, // parallel to legacy gold
  minDeck: { type: Number, default: 30 },                       // creator-set per campaign
  maxDeck: { type: Number, default: 30 },                       // global 30 cap
  progress:{ type: ProgressSchema, default: undefined },        // generator-driven path
  // Run-scoped additive deck & stats (do not mutate campaign baselines)
  extraDeck:  { type: [ExtraDeckEntrySchema], default: [] },
  extraStats: { type: ExtraStatsSchema, default: undefined },
  // Optional versioning for future migrations
  version:   { type: Number, default: 3 },
}, { timestamps: true });

module.exports = mongoose.model('SavedGame', savedGameSchema);
