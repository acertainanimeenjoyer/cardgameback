const mongoose = require('mongoose');

const enemySchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  stats: {
    attackPower:       { type: Number, default: 10 },
    supernaturalPower: { type: Number, default: 10 },
    physicalPower:     { type: Number, default: 10 },
    durability:        { type: Number, default: 10 },
    vitality:          { type: Number, default: 1 },
    intelligence:      { type: Number, default: 1 },
    speed:             { type: Number, default: 5 },
    sp:                { type: Number, default: 3 },
    maxSp:             { type: Number, default: 5 },
    // NEW: ensure DB matches runtime
    defense:           { type: Number, default: 10 }
  },
  imageUrl:   { type: String, default: '' },
  moveSet:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
  description:{ type: String, default: '' },
  aiConfig: {
    cardPriority: [
      {
        cardId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Card' },
        priority: Number
      }
    ],
    combos: [
      {
        cards:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
        priority: Number
      }
    ],
    spSkipThreshold:       { type: Number, default: 0.3 },
    defendHpThreshold:     { type: Number, default: 0.5 },
    skipForComboThreshold: { type: Number, default: 1.25 }, // smart skip AI
    weights: {
      play:   { type: Number, default: 1 },
      skip:   { type: Number, default: 1 },
      defend: { type: Number, default: 1 }
    },
    greedChance: { type: Number, default: 0.15 },
  }
}, { timestamps: true });
enemySchema.index({ owner: 1, createdAt: -1 });
module.exports = mongoose.model('Enemy', enemySchema);