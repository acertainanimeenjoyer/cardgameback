// models/Card.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const MAX_ABILITIES_PER_CARD = 8;
const MAX_ABILITY_DESC_LEN   = 300;

const ScheduleSchema = new Schema({
  type:  { type: String, enum: ['random', 'list'], required: true },
  times: { type: Number, min: 1, default: 1 },    // for random
  turns: { type: [Number], default: [] },         // for list (e.g., [2,4])
}, { _id: false });

const AbilitySchema = new Schema({
  type: {
    type: String,
    enum: [
      'Stats Up', 'Stats Down', 'Freeze', 'Unluck', 'Curse', 'Lucky', 'Guard',
      'Ability Shield', 'Revive', 'Durability Negation', 'Ability Negation',
      'Instant Death', 'Multi-Hit', 'None'
    ],
    required: true,
    default: 'None'
  },
  // Which stat this affects (used by "Stats Up/Down")
  target: {
    type: String,
    enum: ['attackPower','physicalPower','supernaturalPower','durability','speed'],
    default: undefined
  },

  // target shape for this ability (AoE vs Single)
  attackType: { type: String, enum: ['Single','AoE'], default: 'Single' },

  power:            { type: Number, default: 0 },
  duration:         { type: Number, default: 0 },
  activationChance: { type: Number, default: 100 },
  precedence:       { type: Number, default: 0 },

  // identity + lore
  key:  { type: String, trim: true },                         // unique within card (enforced below)
  desc: { type: String, trim: true, maxlength: MAX_ABILITY_DESC_LEN },

  // many-to-many linking via keys; special 'attack' = link to card’s attack event
  linkedTo: { type: [String], default: [] },

  // multi-turn execution
  multiHit: {
    turns:    { type: Number, min: 0, default: 0 },  // 0 = off (now consistent)
    link:     { type: String, default: 'attack' },   // 'attack' or another ability key
    overlap:  { type: String, enum: ['inherit', 'separate'], default: 'inherit' },
    schedule: { type: ScheduleSchema, default: undefined },
    targeting: {
      mode:  { type: String, enum: ['lock', 'retarget-random', 'retarget-choose'], default: 'lock' },
      scope: { type: String, enum: ['character', 'onField-opponent', 'onField-any'], default: 'character' }
    }
  },

  // DN scheduling (auto every hit unless you specify schedule)
  durabilityNegation: {
    auto:     { type: Boolean, default: true },
    schedule: { type: ScheduleSchema, default: undefined },
  },

  // Legacy bridge for old numeric linkedTo
  _legacyLinkedToIndex: { type: Number, default: null, select: false },
}, { _id: false });

const CardSchema = new Schema({
  name:  { type: String, required: true, trim: true },
  type:  {
    type: [String],
    enum: ['Supernatural', 'Physical', 'Buff', 'Debuff', 'Utility', 'Attack'],
    required: true
  },
  rating:      { type: String, enum: ['N', 'R', 'G', 'U'], required: true },
  imageUrl:    { type: String, default: '' },
  descThumbUrl:{ type: String, default: '' },   // outside “desc” button image
  description: { type: String, required: true, trim: true },

  potency: { type: Number, default: 0 },
  defense: { type: Number, default: 0 },

  // default attackType used when abilities link to the card's base "attack" event
  defaultAttackType: { type: String, enum: ['Single','AoE'], default: 'Single' },

  abilities: {
    type: [AbilitySchema],
    default: [],
    validate: {
      validator: a => Array.isArray(a) && a.length <= MAX_ABILITIES_PER_CARD,
      message: `Too many abilities (max ${MAX_ABILITIES_PER_CARD}).`
    }
  },

  // small visual/audio effect for the card:
  // visual (JPG/PNG/GIF) + optional audio (MP3)
  cardEffect: {
    type: new Schema({
      visual: {
        mime:   { type: String, enum: ['image/jpeg','image/png','image/gif'] },
        data:   { type: String, trim: true },  // URL or data: URI
        sizeKB: { type: Number, min: 1 }       // required for data: URIs, optional for URLs
      },
      audio: {
        mime:        { type: String, enum: ['audio/mpeg'] },
        data:        { type: String, trim: true },  // URL or data: URI
        sizeKB:      { type: Number, min: 1 },
        durationSec: { type: Number, min: 0, max: 5 }
      }
    }, { _id: false }),
    default: undefined,
    validate: {
      validator: (v) => {
        if (!v) return true;
        const { visual, audio } = v;
        // allow empty (controller may clear the effect)
        if (!visual && !audio) return true;

        const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

        const okVisual = !visual ? true : (
          ['image/jpeg','image/png','image/gif'].includes(visual.mime) &&
          (isUrl(visual.data) || ((visual.sizeKB ?? 0) <= (visual.mime === 'image/gif' ? 300 : 90)))
        );

        const okAudio = !audio ? true : (
          audio.mime === 'audio/mpeg' &&
          (isUrl(audio.data) || ((audio.sizeKB ?? 0) <= 200)) &&
          ((audio.durationSec ?? 0) <= 5)
        );

        return okVisual && okAudio;
      },
      message: 'cardEffect.visual: JPG/PNG ≤ 90KB or GIF ≤ 300KB; cardEffect.audio: MP3 ≤ 200KB and ≤ 5s.'
    }
  },

  spCost: { type: Number, default: 0 },
  owner:  { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Ensure per-card ability keys exist & are unique, and translate legacy numeric linkedTo
CardSchema.pre('validate', function(next) {
  const card = this;
  const seen = new Set();

  (card.abilities || []).forEach((ab, idx) => {
    // key generation
    if (!ab.key || !ab.key.trim()) {
      ab.key = `${(ab.type || 'None').replace(/\s+/g, '_')}_${idx + 1}`;
    }
    let base = ab.key.trim(), k = base, i = 1;
    while (seen.has(k)) k = `${base}_${++i}`;
    ab.key = k; seen.add(k);

    // legacy numeric linkedTo → defer mapping
    if (typeof ab.linkedTo === 'number') {
      ab._legacyLinkedToIndex = ab.linkedTo;
      ab.linkedTo = [];
    }
  });

  // resolve legacy numeric refs to keys
  (card.abilities || []).forEach((ab) => {
    if (ab._legacyLinkedToIndex != null) {
      const target = card.abilities[ab._legacyLinkedToIndex];
      if (target?.key) {
        ab.linkedTo = Array.from(new Set([...(ab.linkedTo || []), target.key]));
      }
      ab._legacyLinkedToIndex = null;
    }
  });

  // Multi-Hit inherits its attack shape from what it links to; it must not carry its own attackType
  (card.abilities || []).forEach((ab) => {
    if (ab?.type === 'Multi-Hit' && typeof ab.attackType !== 'undefined') {
      ab.attackType = undefined; // remove it so engine uses linked ability or card.defaultAttackType
    }
    // Multi-Hit does not carry its own strength or duration
    if (ab?.type === 'Multi-Hit') {
      ab.power = 0;
      ab.duration = 0;
    }
  });

  // --- Enforce single "primary" Multi-Hit and constrain child multi-hits ---
  const abilities = Array.isArray(card.abilities) ? card.abilities : [];

  // Identify primary: type === 'Multi-Hit' and turns > 0
  const primaries = abilities.filter(ab =>
    ab?.type === 'Multi-Hit' && Number(ab?.multiHit?.turns || 0) > 0
  );

  if (primaries.length > 1) {
    return next(new Error('Only one Multi-Hit ability with turns > 0 is allowed per card.'));
  }

  const primary = primaries[0] || null;
  const primaryTurns = primary ? Math.max(1, Number(primary.multiHit.turns || 0)) : 0;
  const primaryKey = primary?.key;

  if (primary) {
    // Ensure the primary links to the base attack unless explicitly set
    if (!primary.multiHit.link) primary.multiHit.link = 'attack';
  }

  for (const ab of abilities) {
    if (ab === primary) continue;

    const mh = ab?.multiHit;
    const mhTurns = Number(mh?.turns || 0);
    const hasSchedule = !!mh?.schedule;

    // If this ability tries to use multi-hit behavior, require a primary first
    if ((mhTurns > 0 || hasSchedule) && !primary) {
      return next(new Error(
        `Ability "${ab.key || ab.type}" uses Multi-Hit scheduling but no primary Multi-Hit exists on this card.`
      ));
    }

    if (mh && (mhTurns > 0 || hasSchedule) && primary) {
      // Child multi-hit must link to the primary
      ab.multiHit.link = primaryKey;

      // Normalize child window to the primary
      if (mhTurns > primaryTurns) {
        ab.multiHit.turns = primaryTurns; // or 0 if you want children to inherit only by schedule
      }

      // Clamp schedule to 1..primaryTurns
      const sch = ab.multiHit.schedule;
      if (sch?.type === 'list') {
        ab.multiHit.schedule.turns = (Array.isArray(sch.turns) ? sch.turns : [])
          .map(n => Number(n) || 0)
          .filter(n => n >= 1 && n <= primaryTurns);
      } else if (sch?.type === 'random') {
        // times can never exceed the primary window
        const t = Number(sch.times || 1);
        ab.multiHit.schedule.times = Math.min(Math.max(t, 1), primaryTurns);
      }
    }
  }
  next();
});

CardSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model('Card', CardSchema);
