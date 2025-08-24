// models/Room.js
const mongoose = require('mongoose');
const TinyImage = require('./_TinyImage');
const LargeImage = require('./_LargeImage');

// NEW: lightweight audio blob (single song)
const TinyAudio = new mongoose.Schema({
  mime:     { type: String, enum: ['audio/mpeg'], required: true }, // MP3 only
  data:     { type: String, required: true },                        // URL or data:URI
  sizeKB:   { type: Number, max: 3500, required: true },             // ~3.4 MB cap
  durationSec: { type: Number, min: 1, max: 180 }                    // ≤ 3 minutes
}, { _id: false });

const LootItemSchema = new mongoose.Schema({
  kind:   { type: String, enum: ['card','money','statBuff'], required: true },
  cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card' },
  amount: { type: Number },
  stat:   { type: String, enum: ['attackPower','physicalPower','supernaturalPower','durability','vitality','intelligence','speed'] }
}, { _id: false });

const MerchantItemSchema = new mongoose.Schema({
  kind:   { type: String, enum: ['card','statBuff'], required: true },
  cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card' },
  stat:   { type: String, enum: ['attackPower','physicalPower','supernaturalPower','durability','vitality','intelligence','speed'] },
  value:  { type: Number, default: 0 },
  price:  { type: Number, min: 0, default: 0 },
}, { _id: false });

const DialogueSchema = new mongoose.Schema({
  onEnter: { type: String, maxlength: 300 },
  onBuy:   { type: String, maxlength: 300 },
  onExit:  { type: String, maxlength: 300 },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['loot','merchant','event','combat','boss'], required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  // shared visuals
  backgrounds: { type: [LargeImage], default: [], validate: [ arr => arr.length <= 5, 'Max 5 backgrounds' ] },

  // NEW: background music (one MP3)
  roomAudio: { type: TinyAudio, default: undefined },

  // LOOT
  loot: { type: [LootItemSchema], default: undefined },

  // MERCHANT
  merchant: {
    items:        { type: [MerchantItemSchema], default: [] },
    merchantImg:  { type: TinyImage, default: undefined },
    frameImg:     { type: TinyImage, default: undefined },
    dialogue:     { type: DialogueSchema, default: undefined },
  },

  // EVENT
  event: {
    kind:  { type: String, enum: ['meet-loot','no-meet-loot','story-only'], default: 'story-only' },
    characterImg: { type: TinyImage, default: undefined },
    effects: { type: [LootItemSchema], default: [] },
    vnText: { type: [String], default: [] },
  },

  // COMBAT/BOSS
  enemyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enemy' }
}, { timestamps: true });

RoomSchema.index({ owner: 1, createdAt: -1 });
module.exports = mongoose.model('Room', RoomSchema);
