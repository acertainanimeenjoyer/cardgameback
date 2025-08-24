// controllers/cardController.js
const Card = require('../models/Card');
const KNOWN_TYPES = new Set([
  'Stats Up','Stats Down','Freeze','Unluck','Curse','Lucky','Guard',
  'Ability Shield','Revive','Durability Negation','Ability Negation',
  'Instant Death','Multi-Hit','None'
]);
const VALID_TARGETS = new Set(['attackPower','physicalPower','supernaturalPower','durability','speed']);


const normTypes = (body) => {
  const raw = body?.types ?? body?.type;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw ? [raw] : [];
};

const sanitizeSchedule = (s) => {
  if (!s || typeof s !== 'object') return undefined;
  const type = s.type === 'random' || s.type === 'list' ? s.type : undefined;
  if (!type) return undefined;
  const out = { type };
  if (type === 'random') out.times = Math.max(1, Number(s.times ?? 1));
  else out.turns = Array.isArray(s.turns) ? s.turns.map(n => Number(n)).filter(n => n > 0) : [];
  return out;
};

const normOneAbility = (a, idx = 0) => {
  if (!a) return null;

  let type = (a.type ?? a.ability ?? '').toString().trim();
  const nameAsType = (a.name ?? '').toString().trim();
  if (!KNOWN_TYPES.has(type)) type = KNOWN_TYPES.has(nameAsType) ? nameAsType : 'None';

  const key = (a.key ?? ((a.name && !KNOWN_TYPES.has(nameAsType)) ? a.name : '')).toString().trim() || null;

  let linkedTo = [];
  let _legacyLinkedToIndex = null;
  if (Array.isArray(a.linkedTo)) {
    linkedTo = a.linkedTo.map(v => (typeof v === 'string' ? v.trim() : null)).filter(Boolean);
  } else if (typeof a.linkedTo === 'string') {
    linkedTo = [a.linkedTo.trim()];
  } else if (typeof a.linkedTo === 'number') {
    _legacyLinkedToIndex = a.linkedTo;
    linkedTo = [];
  }

  const mhSrc = a.multiHit || (type === 'Multi-Hit'
    ? { turns: a.turns, link: a.link, overlap: a.overlap, schedule: a.schedule, targeting: a.targeting }
    : null);
  const parsedTurns = mhSrc ? Number(mhSrc.turns ?? 0) : 0;
  const targeting = mhSrc?.targeting || {};
  const sch = sanitizeSchedule(mhSrc?.schedule);
  const multiHit = (mhSrc && (parsedTurns >= 1 || sch)) ? {
    turns: parsedTurns,
    link: (mhSrc.link || 'attack'),
    overlap: (mhSrc.overlap === 'separate' ? 'separate' : 'inherit'),
    schedule: sch,
    targeting: {
      mode: (['lock','retarget-random','retarget-choose'].includes(targeting.mode) ? targeting.mode : 'lock'),
      scope: (['character','onField-opponent','onField-any'].includes(targeting.scope) ? targeting.scope : 'character'),
    }
  } : undefined;

  const dnSrc = a.durabilityNegation;
  const durabilityNegation = dnSrc && typeof dnSrc === 'object'
    ? { auto: dnSrc.auto !== false, schedule: sanitizeSchedule(dnSrc.schedule) }
    : undefined;

  const attackType = (a.attackType === 'AoE' || a.attackType === 'Single') ? a.attackType : undefined;
  const target = ( (a.type === 'Stats Up' || a.type === 'Stats Down') && VALID_TARGETS.has(a.target) )
    ? a.target
    : undefined;

  return {
    type,
    key: key || undefined,
    desc: a.desc ? String(a.desc) : undefined,
    power: Number(a.power ?? a.abilityPower ?? 0),
    duration: Number(a.duration ?? 0),
    activationChance: (a.activationChance != null ? Number(a.activationChance) : undefined),
    precedence: Number(a.precedence ?? 0),
    attackType,
    target,
    linkedTo,
    multiHit,
    durabilityNegation,
    _legacyLinkedToIndex
  };
};
// Enforce a single "primary" Multi-Hit (type === 'Multi-Hit' with turns > 0)
// and make any child multi-hits link to it and fit within its window.
const enforcePrimaryMultiHit = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return Array.isArray(arr) ? arr : [];

  const primaries = arr.filter(ab => ab?.type === 'Multi-Hit' && ab?.multiHit && Number(ab.multiHit.turns || 0) > 0);
  if (primaries.length > 1) {
    throw new Error('Only one Multi-Hit ability with turns > 0 is allowed per card.');
  }

  const primary = primaries[0] || null;
  if (!primary) {
    // No primary: hard-fail if any other ability tries to use multi-hit scheduling.
    for (const ab of arr) {
      const mh = ab?.multiHit;
      if (!mh) continue;
      const hasSchedule = !!mh.schedule;
      const hasTurns = Number(mh.turns || 0) > 0;
      if (hasSchedule || hasTurns) {
        throw new Error(`Ability "${ab.key || ab.type}" uses Multi-Hit but no primary Multi-Hit exists on this card.`);
      }
    }
    return arr;
  }

  // Ensure the primary has a unique key (children will link to it)
  if (!primary.key) {
    const used = new Set(arr.map(x => x.key).filter(Boolean));
    let base = 'mh', k = base, n = 1;
    while (used.has(k)) k = `${base}-${n++}`;
    primary.key = k;
  }
  // Default primary link to base attack if not set
  if (!primary.multiHit.link) primary.multiHit.link = 'attack';

  const total = Math.max(1, Number(primary.multiHit.turns || 0));
  const pkey  = primary.key;

  for (const ab of arr) {
    if (ab === primary) continue;
    const mh = ab.multiHit;
    if (!mh) continue;

    // Children must link to the primary
    ab.multiHit.link = pkey;

    // Normalize/extend child window to the primary
    if (!(typeof mh.turns === 'number') || mh.turns < 1 || mh.turns > total) {
      ab.multiHit.turns = total;
    }

    // Clamp schedule within 1..total
    const sch = mh.schedule;
    if (sch?.type === 'list') {
      ab.multiHit.schedule.turns = (Array.isArray(sch.turns) ? sch.turns : [])
        .map(v => Number(v) || 0).filter(v => v >= 1 && v <= total);
    } else if (sch?.type === 'random') {
      const times = Math.max(1, Number(sch.times || 1));
      ab.multiHit.schedule.times = Math.min(times, total);
    }
  }
  return arr;
};

const normAbilities = (abilities) => {
  if (!Array.isArray(abilities)) return [];
  const arr = abilities.map((a, i) => normOneAbility(a, i)).filter(Boolean);
  for (const ab of arr) {
    if (ab.multiHit && (!(typeof ab.multiHit.turns === 'number') || ab.multiHit.turns < 1)) {
      delete ab.multiHit;
    }
  }
  return arr;
};

const normalizeCardEffect = (src) => {
  if (!src) return undefined;
  // Legacy: { kind, mime, data, sizeKB, durationSec }
  if (src.kind) {
    if (src.kind === 'audio') {
      return {
        audio: {
          mime: 'audio/mpeg',
          data: String(src.data || ''),
          sizeKB: src.sizeKB != null ? Number(src.sizeKB) : undefined,
          durationSec: src.durationSec != null ? Number(src.durationSec) : undefined
        }
      };
    } else if (src.kind === 'image') {
      // Accept jpg/png; keep png for back-compat
      const mime = (src.mime === 'image/png' || src.mime === 'image/jpeg') ? src.mime : 'image/jpeg';
      return {
        visual: {
          mime,
          data: String(src.data || ''),
          sizeKB: src.sizeKB != null ? Number(src.sizeKB) : undefined
        }
      };
    } else {
      return { _invalid: 'Unknown legacy cardEffect.kind' };
    }
  }

  // New shape:
  const out = {};
  if (src.visual) {
    const v = src.visual;
    const mime = (v.mime === 'image/jpeg' || v.mime === 'image/png' || v.mime === 'image/gif') ? v.mime : undefined;
    if (!mime) return { _invalid: 'visual.mime must be image/jpeg, image/png, or image/gif' };
    out.visual = {
      mime,
      data: String(v.data || ''),
      sizeKB: v.sizeKB != null ? Number(v.sizeKB) : undefined
    };
  }
  if (src.audio) {
    const a = src.audio;
    if (a.mime && a.mime !== 'audio/mpeg') return { _invalid: 'audio.mime must be audio/mpeg' };
    out.audio = {
      mime: 'audio/mpeg',
      data: String(a.data || ''),
      sizeKB: a.sizeKB != null ? Number(a.sizeKB) : undefined,
      durationSec: a.durationSec != null ? Number(a.durationSec) : undefined
    };
  }

  // If neither provided, treat as clearing
  if (!out.visual && !out.audio) return undefined;
  // Quick limits (exact enforcement is in model validation)
  if (out.visual?.mime === 'image/gif' && (out.visual.sizeKB ?? 0) > 300) {
    return { _invalid: 'GIF must be ≤ 300KB' };
  }
  return out;
};

// ----- CREATE -----
const createCard = async (req, res) => {
  try {
    // Enforce authenticated ownership on create
    if (!req.user?._id) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const {
      name, rating, imageUrl, descThumbUrl, description, abilities,
      spCost, /* owner ignored */ potency, defense, defaultAttackType, cardEffect
    } = req.body ?? {};

    const typesArr = normTypes(req.body);
    if (!name || typesArr.length === 0) {
      return res.status(400).json({ message: 'Validation error: "name" and non-empty "type"/"types" are required.' });
    }

    const ce = normalizeCardEffect(cardEffect);
    let abs;
    try {
      abs = enforcePrimaryMultiHit(normAbilities(abilities));
    } catch (e) {
      return res.status(400).json({ message: String(e.message || e) });
    }

    {
      const atk = Number(potency ?? 0);
      const def = Number(defense ?? 0);
      const needsType = atk > 0 || def > 0;
      const hasPhysOrSup = Array.isArray(typesArr) && (typesArr.includes('Physical') || typesArr.includes('Supernatural'));
      if (needsType && !hasPhysOrSup) {
        return res.status(400).json({
          message: 'Validation error: when potency or defense > 0, type must include "Physical" or "Supernatural".'
        });
      }
    }
    if (ce && ce._invalid) return res.status(400).json({ message: ce._invalid });

    const card = new Card({
      name: String(name),
      type: typesArr,
      rating,
      imageUrl,
      descThumbUrl,
      description,
      potency: (potency != null ? Number(potency) : undefined),
      defense: (defense != null ? Number(defense) : undefined),
      defaultAttackType: (defaultAttackType === 'AoE' ? 'AoE' : 'Single'),
      abilities: abs,
      cardEffect: ce,
      spCost: Number(spCost ?? 0),
      owner: req.user._id, // enforce authenticated user
    });

    await card.save();
    res.status(201).json(card);
  } catch (err) {
    console.error('[CARD_CONTROLLER][CREATE]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----- GET ALL -----
const getAllCards = async (req, res) => {
  try {
    const scope = String(req.query.scope || 'mine').toLowerCase();
    const filter = (req.user && scope !== 'all') ? { owner: req.user._id } : {};
    const cards = await Card.find(filter);
    res.json(cards);
  } catch (err) {
    console.error('[CARD_CONTROLLER][GET_ALL]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----- GET ONE -----
const getCard = async (req, res) => {
  try {
    const card = await Card.findById(req.params.id);
    if (!card) return res.status(404).json({ message: 'Card not found' });
    res.json(card);
  } catch (err) {
    console.error('[CARD_CONTROLLER][GET]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----- UPDATE -----
const updateCard = async (req, res) => {
  try {
    const body = req.body ?? {};
    const update = {};

    const current = await Card.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Card not found' });
    if (current.owner && req.user && String(current.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: not the owner' });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'name'))        update.name = body.name;
    if (Object.prototype.hasOwnProperty.call(body, 'rating'))      update.rating = body.rating;
    if (Object.prototype.hasOwnProperty.call(body, 'imageUrl'))    update.imageUrl = body.imageUrl;
    if (Object.prototype.hasOwnProperty.call(body, 'descThumbUrl'))update.descThumbUrl = body.descThumbUrl;
    if (Object.prototype.hasOwnProperty.call(body, 'description')) update.description = body.description;
    // Do NOT allow changing owner via update
    if (Object.prototype.hasOwnProperty.call(body, 'potency')) update.potency = Number(body.potency);
    if (Object.prototype.hasOwnProperty.call(body, 'defense')) update.defense = Number(body.defense);
    if (Object.prototype.hasOwnProperty.call(body, 'defaultAttackType')) {
      update.defaultAttackType = (body.defaultAttackType === 'AoE' ? 'AoE' : 'Single');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'type') || Object.prototype.hasOwnProperty.call(body, 'types')) {
      update.type = normTypes(body);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'abilities')) {
      try {
        update.abilities = enforcePrimaryMultiHit(normAbilities(body.abilities));
      } catch (e) {
        return res.status(400).json({ message: String(e.message || e) });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'spCost')) {
      update.spCost = Number(body.spCost ?? 0);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'cardEffect')) {
      if (body.cardEffect === null || body.cardEffect === '') {
        update.cardEffect = undefined;
      } else {
        const ce = normalizeCardEffect(body.cardEffect);
        if (ce && ce._invalid) return res.status(400).json({ message: ce._invalid });
        update.cardEffect = ce;
      }
    }
    // Enforce: if potency/defense > 0, require Physical or Supernatural in the *resulting* card state
    {
      const nextTypes = (Object.prototype.hasOwnProperty.call(body, 'type') || Object.prototype.hasOwnProperty.call(body, 'types'))
        ? normTypes(body)
        : (Array.isArray(current.type) ? current.type : []);

      const nextPotency = Object.prototype.hasOwnProperty.call(body, 'potency')
        ? Number(body.potency)
        : Number(current.potency || 0);

      const nextDefense = Object.prototype.hasOwnProperty.call(body, 'defense')
        ? Number(body.defense)
        : Number(current.defense || 0);

      const needsType = (nextPotency > 0) || (nextDefense > 0);
      const hasPhysOrSup = Array.isArray(nextTypes) && (nextTypes.includes('Physical') || nextTypes.includes('Supernatural'));
      if (needsType && !hasPhysOrSup) {
        return res.status(400).json({
          message: 'Validation error: when potency or defense > 0, type must include "Physical" or "Supernatural".'
        });
      }
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'No fields provided to update.' });
    }

    const card = await Card.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!card) return res.status(404).json({ message: 'Card not found' });
    res.json(card);
  } catch (err) {
    console.error('[CARD_CONTROLLER][UPDATE]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----- DELETE -----
const deleteCard = async (req, res) => {
  try {
    const current = await Card.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Card not found' });
    if (current.owner && req.user && String(current.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: not the owner' });
    }
    const card = await Card.findByIdAndDelete(req.params.id);
    res.json({ message: 'Card deleted', card });
  } catch (err) {
    console.error('[CARD_CONTROLLER][DELETE]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----- BULK CREATE -----
const createCardsBulk = async (req, res) => {
  try {
    // Enforce authenticated ownership on bulk create
    if (!req.user?._id) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const payload = Array.isArray(req.body) ? req.body : (req.body.cards || []);
    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({ message: 'Provide an array of cards (or { cards: [...] }).' });
    }

    const docs = payload.map(item => {
      const {
        name, rating, imageUrl, descThumbUrl, description, abilities,
        spCost, /* owner ignored */ potency, defense, defaultAttackType, cardEffect
      } = item ?? {};
      const typesArr = normTypes(item);
      if (!name || typesArr.length === 0) throw new Error('Each card requires "name" and non-empty "type"/"types".');
      let abs;
      abs = enforcePrimaryMultiHit(normAbilities(abilities));
      // Enforce: if potency/defense > 0, require Physical or Supernatural
      {
        const atk = Number(potency ?? 0);
        const def = Number(defense ?? 0);
        const needsType = atk > 0 || def > 0;
        const hasPhysOrSup = Array.isArray(typesArr) && (typesArr.includes('Physical') || typesArr.includes('Supernatural'));
        if (needsType && !hasPhysOrSup) {
          throw new Error('When potency or defense > 0, type must include "Physical" or "Supernatural".');
        }
      }
      for (const ab of abs) {
        if (ab.multiHit && (!(typeof ab.multiHit.turns === 'number') || ab.multiHit.turns < 1)) delete ab.multiHit;
      }

      const ce = normalizeCardEffect(cardEffect);
      if (ce && ce._invalid) throw new Error(ce._invalid);

      return {
        name: String(name),
        type: typesArr,
        rating,
        imageUrl,
        descThumbUrl,
        description,
        potency: (potency != null ? Number(potency) : undefined),
        defense: (defense != null ? Number(defense) : undefined),
        defaultAttackType: (defaultAttackType === 'AoE' ? 'AoE' : 'Single'),
        abilities: abs,
        cardEffect: ce,
        spCost: Number(spCost ?? 0),
        owner: req.user._id, // enforce authenticated user
      };
    });

    const created = await Card.insertMany(docs, { ordered: true });
    res.status(201).json(created);
  } catch (err) {
    console.error('[CARD_CONTROLLER][CREATE_BULK]', err);
    res.status(400).json({ message: 'Bulk card creation failed', error: String(err.message || err) });
  }
};

// ----- DELETE ALL -----
const deleteAllCards = async (req, res) => {
  try {
    const result = await Card.deleteMany({});
    res.status(200).json({
      message: 'All cards deleted',
      deletedCount: result?.deletedCount ?? 0
    });
  } catch (err) {
    console.error('[CARD_CONTROLLER][DELETE_ALL]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createCard,
  getAllCards,
  getCard,
  updateCard,
  deleteCard,
  createCardsBulk,
  deleteAllCards,
};
