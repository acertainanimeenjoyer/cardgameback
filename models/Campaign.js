// models/Campaign.js
const mongoose = require('mongoose');
const TinyImage = require('./_TinyImage');

const DeckEntrySchema = new mongoose.Schema({
  cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
  qty:    { type: Number, min: 1, max: 30, default: 1 }
}, { _id: false });

const PlayerInitialStatsSchema = new mongoose.Schema({
  attackPower:        { type: Number },
  physicalPower:      { type: Number },
  supernaturalPower:  { type: Number },
  durability:         { type: Number },
  vitality:           { type: Number },
  intelligence:       { type: Number },
  speed:              { type: Number },
  sp:                 { type: Number },
  maxSp:              { type: Number },
  // Optional: explicit base HP; if omitted, server can derive from vitality
  hp:                 { type: Number },
}, { _id: false });

const WeightedTypeSchema = new mongoose.Schema({
  type:   { type: String, enum: ['combat','loot','merchant','event','rest'], required: true },
  weight: { type: Number, min: 0, default: 1 }
}, { _id: false });

const RandomLootSchema = new mongoose.Schema({
  items: [{
    kind:   { type: String, enum: ['card','money','statBuff'], required: true },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card' },
    amount: { type: Number },
    stat:   { type: String, enum: ['attackPower','physicalPower','supernaturalPower','durability','vitality','intelligence','speed'] }
  }],
  maxPicks: { type: Number, min: 1, max: 3, default: 1 }  // “max 3 loots at once” from your doc
}, { _id: false });

const CampaignSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  cover:       { type: TinyImage, default: undefined },
  length:      { type: Number, min: 1, max: 100, default: 10 },
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  likes:       { type: Number, default: 0 },
  playerSetup: {
    startingDeck: { type: [DeckEntrySchema], default: [] }, // array of { cardId, qty }
    startingHandSize: { type: Number, min: 0, max: 10, default: 5 },
    minDeckSize: { type: Number, min: 0, max: 30, default: 10 }, // creator-chosen; below = auto-lose
    maxDeckSize: { type: Number, min: 1, max: 30, default: 30 },
    initialStats: { type: PlayerInitialStatsSchema, default: undefined }
  },
  // Editable generator:
  generator: {
    useWeighted: { type: Boolean, default: true },
    roomWeights: { type: [WeightedTypeSchema], default: [
      { type: 'combat', weight: 4 }, { type: 'loot', weight: 2 }, { type: 'merchant', weight: 1 }, { type: 'event', weight: 2 }
    ]},
    insertRestBefore: { type: String, enum: ['combat','boss','none'], default: 'boss' }, // Rest Area injection
    enemiesMin: { type: Number, min: 1, max: 4, default: 1 },
    enemiesMax: { type: Number, min: 1, max: 4, default: 3 },
    bossMin:    { type: Number, min: 1, max: 4, default: 1 },
    bossMax:    { type: Number, min: 1, max: 4, default: 3 },
    randomLoot: { type: RandomLootSchema, default: undefined }, // used by LootRoom when room.loot not set
  },
  // Hand-crafted campaign path (optional)
  roomSequence: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Room' }], // if provided, overrides generator
}, { timestamps: true });
CampaignSchema.index({ owner: 1, createdAt: -1 });
module.exports = mongoose.model('Campaign', CampaignSchema);
