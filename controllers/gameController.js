const SavedGame = require('../models/SavedGame');
const Enemy     = require('../models/Enemy');
const Card      = require('../models/Card');
const Campaign = require('../models/Campaign');

const HAND_SIZE = 3;
const MAX_FIELD_SLOTS = 3;

/* =========================
   Normalizers & Utils
   ========================= */
const getTypes = (card) => {
  const raw = card?.type ?? card?.types;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw ? [raw] : [];
};

// NOTE: supports new schema fields: key, linkedTo[], multiHit, durabilityNegation
const normalizeAbility = (ab, idx=0) => {
  const legacyTargetCode =
    typeof ab?.linkedTo === 'number' ? ab.linkedTo
    : (typeof ab?._legacyLinkedToIndex === 'number' ? ab._legacyLinkedToIndex
    : null);

  const linkedTo =
    Array.isArray(ab?.linkedTo) ? ab.linkedTo.filter(Boolean)
    : (typeof ab?.linkedTo === 'string' ? [ab.linkedTo] : []);

  const key = (ab?.key && String(ab.key).trim())
    ? String(ab.key).trim()
    : `${String(ab?.type ?? ab?.name ?? 'None').replace(/\s+/g,'_')}_${idx+1}`;

  return {
    type: (ab?.type ?? ab?.name ?? 'None'),
    key,
    desc: (ab?.desc ? String(ab.desc) : undefined),
    power: Number(ab?.power ?? ab?.abilityPower ?? 0),
    duration: Number(ab?.duration ?? 0),
    activationChance: ab?.activationChance != null ? Number(ab.activationChance) : 100,
    precedence: Number(ab?.precedence ?? 0),

    linkedTo, // array of ability keys or 'attack'
    legacyTargetCode,

    // multi-turn driver (optional)
    multiHit: ab?.multiHit && typeof ab.multiHit === 'object' ? {
      turns:    Math.max(0, Number(ab.multiHit.turns ?? 0)),
      link:     ab.multiHit.link || 'attack',
      overlap:  ['inherit','separate'].includes(ab.multiHit.overlap) ? ab.multiHit.overlap : 'inherit',
      schedule: ab.multiHit.schedule && typeof ab.multiHit.schedule === 'object' ? {
        type:   ab.multiHit.schedule.type,
        times:  Math.max(1, Number(ab.multiHit.schedule.times ?? 1)),
        turns:  Array.isArray(ab.multiHit.schedule.turns) ? ab.multiHit.schedule.turns.map(n => Number(n)).filter(n => n>0) : []
      } : undefined,
      // NEW: preserve optional retargeting config
      targeting: ab.multiHit.targeting && typeof ab.multiHit.targeting === 'object' ? {
        mode:  ab.multiHit.targeting.mode,
        scope: ab.multiHit.targeting.scope
      } : undefined
    } : undefined,

    // DN scheduling (optional)
    durabilityNegation: ab?.durabilityNegation && typeof ab.durabilityNegation === 'object' ? {
      auto: ab.durabilityNegation.auto !== false,
      schedule: ab.durabilityNegation.schedule && typeof ab.durabilityNegation.schedule === 'object' ? {
        type:  ab.durabilityNegation.schedule.type,
        times: Math.max(1, Number(ab.durabilityNegation.schedule.times ?? 1)),
        turns: Array.isArray(ab.durabilityNegation.schedule.turns) ? ab.durabilityNegation.schedule.turns.map(n => Number(n)).filter(n => n>0) : []
      } : undefined
    } : { auto: true, schedule: undefined }
  };
};

const getAbilities = (card) => {
  const arr = Array.isArray(card?.abilities) ? card.abilities : [];
  return arr.map((ab, i) => normalizeAbility(ab, i));
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const roll  = (chancePct) => Math.random() * 100 < clamp(chancePct, 0, 100);
const intMult = (baseChance, intStat) => {
  const bonus = clamp((Number(intStat) || 0) / 1000, 0, 1); // 10 INT -> +1% of base
  return clamp(baseChance + baseChance * bonus, 0, 100);
};
const willDodge = (attackerTemp, defenderTemp, ctx, sideKey, otherK) => {
  let p = clamp(((Number(defenderTemp.speed) || 0) - (Number(attackerTemp.speed) || 0)) / 100, 0, 1);
  // Lucky/Unluck apply as flat %-points
  if (ctx && sideKey && otherK) {
    p = clamp(p + (ctx[otherK].chanceUp - ctx[sideKey].chanceDown) / 100, 0, 1);
  }
  return Math.random() < p;
};

const pickRandomUniqueTurns = (totalTurns, count) => {
  const all = Array.from({length: totalTurns}, (_,i)=>i+1);
  const picks = new Set();
  while (picks.size < Math.min(count, totalTurns)) {
    const idx = Math.floor(Math.random()*all.length);
    const turn = all.splice(idx,1)[0];
    picks.add(turn);
  }
  return Array.from(picks);
};

/* =========================
   Draw Helper (unchanged)
   ========================= */
function drawUpToHand(oldHand, deck, discard, played, handSize) {
  let newHand = oldHand.filter(
    c => !played.some(pc => String(pc.instanceId) === String(c.instanceId))
  );
  const handInstanceIds = new Set(newHand.map(c => String(c.instanceId)));
  while (newHand.length < handSize && deck.length > 0) {
    const next = deck.shift();
    if (!handInstanceIds.has(String(next.instanceId))) {
      newHand.push(next);
      handInstanceIds.add(String(next.instanceId));
    }
  }
  if (newHand.length < handSize && discard.length > 0) {
    let reshuffle = [...discard];
    discard = [];
    for (let i = reshuffle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [reshuffle[i], reshuffle[j]] = [reshuffle[j], reshuffle[i]];
    }
    deck.push(...reshuffle);
    while (newHand.length < handSize && deck.length > 0) {
      const next = deck.shift();
      if (!handInstanceIds.has(String(next.instanceId))) {
        newHand.push(next);
        handInstanceIds.add(String(next.instanceId));
      }
    }
  }
  return { newHand, newDeck: deck, newDiscard: discard };
}

/* =========================
   Enemy AI (unchanged logic)
   ========================= */
function chooseEnemyAction(enemyStats, enemySp, enemyHp, enemyMaxHp, enemyHand, aiConfig) {
  const { cardPriority, combos, spSkipThreshold, defendHpThreshold, weights } = aiConfig;
  function resolveCards(cardArr, hand) {
    return (cardArr || []).map(idOrObj => {
      if (typeof idOrObj === 'object' && idOrObj && idOrObj._id) {
        return hand.find(c => c && c._id && (c._id.equals ? c._id.equals(idOrObj._id) : c._id === idOrObj._id));
      }
      return hand.find(c => c && c._id && (c._id.equals ? c._id.equals(idOrObj) : c._id === idOrObj));
    }).filter(Boolean);
  }
  let bestCombo = null, bestComboScore = 0;
  combos.forEach(({ cards, priority }) => {
    const cardObjs = resolveCards(cards, enemyHand);
    const cost = cardObjs.reduce((sum, c) => sum + (typeof c.spCost === 'number' ? c.spCost : 0), 0);
    if (cardObjs.length === cards.length && cost <= enemySp && priority > bestComboScore) {
      bestComboScore = priority;
      bestCombo = cardObjs;
    }
  });
  const safeHand = Array.isArray(enemyHand) ? enemyHand.filter(Boolean) : [];
  const singles = safeHand.filter(c =>
    !bestCombo || !bestCombo.some(bc => bc && c && bc.instanceId && c.instanceId && String(bc.instanceId) === String(c.instanceId))
  );
  singles.sort((a, b) => {
    const pa = cardPriority.find(x => x.cardId && a._id && (x.cardId.equals ? x.cardId.equals(a._id) : x.cardId === a._id))?.priority || 0;
    const pb = cardPriority.find(x => x.cardId && b._id && (x.cardId.equals ? x.cardId.equals(b._id) : x.cardId === b._id))?.priority || 0;
    return pb - pa;
  });
  let runningSp = bestCombo ? bestCombo.reduce((s, c) => s + (typeof c.spCost === 'number' ? c.spCost : 0), 0) : 0;
  const playCards = bestCombo ? [...bestCombo] : [];
  for (const c of singles) {
    const cost = (typeof c.spCost === 'number' ? c.spCost : 0);
    if (runningSp + cost <= enemySp) {
      playCards.push(c);
      runningSp += cost;
    }
  }
  const greedChance = aiConfig.greedChance ?? 0.15;
  if (!bestCombo && playCards.length > 0 && Math.random() < greedChance) {
    return { action: 'play', cards: playCards };
  }
  if (playCards.some(c => typeof c !== 'object' || !c.name)) {
    return { action: 'skip', cards: [] };
  }
  const playScore = weights.play * (
    bestComboScore +
    playCards.reduce((sum, c) =>
      sum + (cardPriority.find(x => x.cardId && c._id && (x.cardId.equals ? x.cardId.equals(c._id) : x.cardId === c._id))?.priority || 0), 0)
  );
  const spRatio = enemySp / enemyStats.maxSp;
  const skipBoost = spRatio < spSkipThreshold
    ? (spSkipThreshold - spRatio) / spSkipThreshold
    : 0;
  const skipScore = weights.skip * skipBoost;
  const hpRatio = enemyHp / enemyMaxHp;
  const defendBoost = hpRatio < defendHpThreshold
    ? (defendHpThreshold - hpRatio) / defendHpThreshold
    : 0;
  const defendScore = weights.defend * defendBoost;
  if (playScore >= defendScore && playScore >= skipScore) return { action: 'play', cards: playCards };
  if (defendScore >= skipScore) return { action: 'defend' };
  return { action: 'skip' };
}

/* =========================
   Ability Engine with Persistence
   ========================= */

// persistent vs per-attack
const PERSISTENT_TYPES = new Set([
  'Stats Up', 'Stats Down', 'Lucky', 'Unluck', 'Freeze', 'Curse',
  'Guard', 'Ability Shield', 'Revive'
]);
const PER_ATTACK_TYPES = new Set([
  'Durability Negation', 'Ability Negation', 'Instant Death'
]);

// linkedTo mapping for targeted stat buffs/debuffs (legacy numeric)
function resolveStatTarget(ab, card) {
  if (ab?.target) return ab.target;
  const code = Number.isInteger(ab?.legacyTargetCode) ? ab.legacyTargetCode : Number(ab?.linkedTo);
  if (Number.isInteger(code)) {
    switch (code) {
      case 1: return 'attackPower';
      case 2: return 'physicalPower';
      case 3: return 'supernaturalPower';
      case 4: return 'durability';
      case 5: return 'speed';
    }
  }
  const types = getTypes(card);
  if (types.includes('Physical')) return 'physicalPower';
  if (types.includes('Supernatural')) return 'supernaturalPower';
  return 'attackPower';
}

// convert request.activeEffects into normalized, type-keyed buckets
function loadActiveBuckets(activeEffects) {
  const makeMap = (arr) => {
    const map = new Map();
    (Array.isArray(arr) ? arr : []).forEach(e => {
      if (!e || !e.type) return;
      map.set(e.type + (e.target ? `:${e.target}` : ''), {
        type: e.type,
        target: e.target || null,
        power: Number(e.power) || 0,
        precedence: Number(e.precedence) || 0,
        remaining: Math.max(0, Number(e.remaining) || 0),
      });
    });
    return map;
  };
  return {
    player: makeMap(activeEffects?.player),
    enemy:  makeMap(activeEffects?.enemy),
  };
}

// turn bucket maps back to arrays for response
function dumpActiveBuckets(buckets) {
  const toArray = (map) => Array.from(map.values()).map(e => ({
    type: e.type,
    target: e.target || null,
    power: e.power,
    precedence: e.precedence,
    remaining: e.remaining,
  }));
  return { player: toArray(buckets.player), enemy: toArray(buckets.enemy) };
}

// Distinguish insert vs refresh (logging) + explicit Freeze logs
function upsertPersistentEffect(bucketMap, entry, bucketOwner) {
  const key = entry.type + (entry.target ? `:${entry.target}` : '');
  const existing = bucketMap.get(key);
  if (existing) {
    const before = { power: existing.power, precedence: existing.precedence, remaining: existing.remaining };
    existing.power = entry.power;
    existing.precedence = Math.max(existing.precedence, entry.precedence || 0);
    existing.remaining = Math.max(entry.duration || 0, 0);
    console.log(`[PERSIST][UPSERT] refresh key=${key} rem ${before.remaining}→${existing.remaining} pow ${before.power}→${existing.power} prec ${before.precedence}→${existing.precedence}`);
    if (entry.type === 'Freeze') {
      console.log('[FREEZE][UPSERT]', {
        owner: bucketOwner,
        key: entry.key,
        duration: entry.duration,
        activationChance: entry.activationChance
      });
    }
  } else {
    const inserted = {
      type: entry.type,
      target: entry.target || null,
      power: entry.power || 0,
      precedence: entry.precedence || 0,
      remaining: Math.max(entry.duration || 0, 0),
      // note: we don't persist 'key' onto map to keep FE echoes simple
    };
    bucketMap.set(key, inserted);
    console.log(`[PERSIST][UPSERT] insert  key=${key} rem=${inserted.remaining} pow=${inserted.power} prec=${inserted.precedence}`);
    if (entry.type === 'Freeze') {
      console.log('[FREEZE][UPSERT]', {
        owner: bucketOwner,
        key: entry.key,
        duration: entry.duration,
        activationChance: entry.activationChance
      });
    }
  }
}

// apply buckets to temp stats / context for this action
function applyPersistentToContext({ sideKey, buckets, tempStats, ctx }) {
  for (const eff of buckets[sideKey].values()) {
    if (eff.remaining <= 0) continue;
    console.log(`[PERSIST][APPLY] ${sideKey} ${eff.type}${eff.target?`(${eff.target})`:''} rem=${eff.remaining}`);
    switch (eff.type) {
      case 'Stats Up': {
        const stat = eff.target || 'attackPower';
        tempStats[stat] = Number(tempStats[stat] || 0) + eff.power;
        console.log('[PERSIST][APPLY]', { owner: sideKey, type: 'Stats Up', stat, delta: +eff.power, rem: eff.remaining });
        break;
      }
      case 'Stats Down': {
        const stat = eff.target || 'attackPower';
        tempStats[stat] = Number(tempStats[stat] || 0) - Number(eff.power || 0);
        console.log('[PERSIST][APPLY]', { owner: sideKey, type: 'Stats Down', stat, delta: -eff.power, rem: eff.remaining });
        break;
      }
      case 'Lucky':
        ctx[sideKey].chanceUp += eff.power;
        break;
      case 'Unluck':
        ctx[sideKey].chanceDown += eff.power;
        break;
      case 'Freeze':
        ctx[sideKey].frozenTurns = Math.max(ctx[sideKey].frozenTurns, 1);
        tempStats.speed = 0;
        console.log('[FREEZE][APPLY]', { owner: sideKey, rem: eff.remaining });
        break;
      case 'Curse':
        ctx[sideKey].curseSuppress = Math.max(ctx[sideKey].curseSuppress, Math.min(3, Math.max(0, Math.floor(eff.power))));
        break;
      case 'Guard':
        ctx[sideKey].guard = { active: true, precedence: eff.precedence, duration: eff.remaining };
        break;
      case 'Ability Shield':
        ctx[sideKey].abilityShield = { active: true, precedence: eff.precedence, duration: eff.remaining };
        break;
      case 'Revive':
        ctx[sideKey].revive = { power: eff.power, precedence: eff.precedence, duration: eff.remaining };
        break;
    }
  }
}

// ability queue (highest precedence first)
function buildEffectQueue(cards) {
  const entries = [];
  for (const card of cards) {
    const abilities = getAbilities(card);
    for (let i = 0; i < abilities.length; i++) {
      const ab = abilities[i];
      if (!ab.type || ab.type === 'None' || ab.activationChance <= 0) continue;
      entries.push({ card, ability: ab });
    }
  }
  entries.sort((a, b) => (b.ability.precedence || 0) - (a.ability.precedence || 0));
  return entries;
}

function applyAbilityPreDamagePhase({
  attackerBase, defenderBase,
  attackerTemp, defenderTemp,
  attackerCards, defenderCards,
  context,
  buckets,
  sourceKey, targetKey, // 'player' or 'enemy'
  // NEW: attack-linked bucket to evaluate on hit
  attackLinkedOut
}) {
  const blockedByShield = (onTarget, ab) => {
    const shield = context[onTarget].abilityShield;
    return shield.active && (shield.precedence >= (ab.precedence || 0));
  };

  const pending = { [sourceKey]: [], [targetKey]: [] };

  // track success of abilities by key within each card (for linkedTo dependencies)
  const successByCardKey = new Map(); // card.instanceId -> Set(keys)

  const queueApply = (queue, owner, target) => {
    for (const entry of queue) {
      const { card, ability: ab } = entry;

      // If ab depends on other abilities (excluding 'attack'), ensure those parents succeeded already
      const parents = (ab.linkedTo || []).filter(x => x !== 'attack');
      if (parents.length) {
        const ok = parents.every(p => successByCardKey.get(String(card.instanceId))?.has(p));
        if (!ok) continue; // parent not (yet) successful
      }

      // compute final chance with Lucky/Unluck and INT multiplier (log)
      const ownerTemp = owner === sourceKey ? attackerTemp : defenderTemp;
      const baseChance = clamp(ab.activationChance + context[owner].chanceUp - context[target].chanceDown, 0, 100);
      const finalChance = intMult(baseChance, ownerTemp.intelligence);
      console.log(`[AB][CHK] ${owner} plays ${ab.type} (key=${ab.key ?? 'n/a'}) base=${baseChance}% INT→final=${finalChance}%`);

      // opponent-targeting?
      const targetsOpponent = (
        ab.type === 'Stats Down' || ab.type === 'Freeze' || ab.type === 'Unluck' ||
        ab.type === 'Curse' || ab.type === 'Ability Negation' || ab.type === 'Instant Death' ||
        ab.type === 'Durability Negation'
      );

      // shield block check for opponent-targeting (log)
      if (targetsOpponent && blockedByShield(target, ab)) {
        console.log(`[AB][BLOCKED] ${ab.type} blocked by ${target}'s Ability Shield (prec=${context[target].abilityShield.precedence} ≥ ${ab.precedence || 0})`);
        continue;
      }

      // attack-linked abilities are deferred to the on-hit step (log + no roll here)
      if ((ab.linkedTo || []).includes('attack')) {
        console.log(`[AB][DEFER] ${ab.type} linked to attack; deferring to on-hit (card iid=${card.instanceId})`);
        const list = attackLinkedOut.get(String(card.instanceId)) || [];
        list.push({ card, ability: ab, owner, target });
        attackLinkedOut.set(String(card.instanceId), list);
        // mark success so children can chain further
        if (!successByCardKey.has(String(card.instanceId))) successByCardKey.set(String(card.instanceId), new Set());
        successByCardKey.get(String(card.instanceId)).add(ab.key);
        continue;
      }

      // roll outcome (log)
      if (!roll(finalChance)) {
        console.log(`[AB][MISS] ${ab.type} failed roll (final=${finalChance}%)`);
        continue;
      }
      console.log(`[AB][OK] ${ab.type} accepted pre-damage`);

      pending[owner].push(entry);

      // Mark success for linking chains
      if (!successByCardKey.has(String(card.instanceId))) successByCardKey.set(String(card.instanceId), new Set());
      successByCardKey.get(String(card.instanceId)).add(ab.key);

      // Immediate toggles (apply to context now so later abilities see them)
      if (ab.type === 'Ability Shield') {
        context[owner].abilityShield = { active: true, precedence: ab.precedence || 0, duration: ab.duration || 1 };
      }
      if (ab.type === 'Guard') {
        context[owner].guard = { active: true, precedence: ab.precedence || 0, duration: ab.duration || 1 };
      }
    }
  };

  const atkQueue = buildEffectQueue(attackerCards);
  const defQueue = buildEffectQueue(defenderCards);
  queueApply(atkQueue, sourceKey,  targetKey);
  queueApply(defQueue, targetKey,  sourceKey);

  // Ability Negation (strip lower-precedence persistent effects on target)
  const applyNegation = (owner, target) => {
    const entries = pending[owner].filter(p => p.ability.type === 'Ability Negation' && p.ability.power > 0);
    if (!entries.length) return;
    const tgtBucket = buckets[target];
    entries.forEach(({ ability: ab }) => {
      let remainingToRemove = Math.min(3, Math.max(1, Math.floor(ab.power)));
      const ordered = Array.from(tgtBucket.values()).sort((a, b) => (a.precedence || 0) - (b.precedence || 0));
      for (let i = 0; i < ordered.length && remainingToRemove > 0; i++) {
        if ((ordered[i].precedence || 0) < (ab.precedence || 0)) {
          tgtBucket.delete(ordered[i].type + (ordered[i].target ? `:${ordered[i].target}` : ''));
          remainingToRemove--;
        }
      }
    });
    const maxPrec = Math.max(...entries.map(x => x.ability.precedence || 0));
    pending[target] = pending[target].filter(e => (e.ability.precedence || 0) >= maxPrec);
  };
  applyNegation(sourceKey, targetKey);
  applyNegation(targetKey, sourceKey);

  // Adopt pending persistent effects (no stacking — duration resets)
  // NOTE: opponent-targeting effects must go to the target bucket.
  const adoptPendingFor = (owner, target) => {
    for (const { card, ability: ab } of pending[owner]) {
      if (!PERSISTENT_TYPES.has(ab.type)) continue;

      const targetsOpponent = (
        ab.type === 'Stats Down' || ab.type === 'Freeze' || ab.type === 'Unluck' ||
        ab.type === 'Curse' || ab.type === 'Ability Negation' || ab.type === 'Instant Death' ||
        ab.type === 'Durability Negation'
      );

      const dest = targetsOpponent ? target : owner;
      const entry = { ...ab };
      if (ab.type === 'Stats Up' || ab.type === 'Stats Down') {
        entry.target = resolveStatTarget(ab, card);
      }

      upsertPersistentEffect(buckets[dest], entry, dest);
      console.log(`[AB][PERSIST] ${ab.type} → ${dest} (key=${ab.key ?? 'n/a'}, pow=${entry.power}, dur=${entry.duration}, prec=${entry.precedence})`);
    }
  };

  adoptPendingFor(sourceKey, targetKey);
  adoptPendingFor(targetKey, sourceKey);

  // Apply persistent buckets to *temp* stats/context for this action (already applied by caller in our flow)
  // Per-card flags used in damage phase
  const perCard = (cards) => {
    const out = new Map();
    for (const card of cards) {
      const abilities = getAbilities(card);
      const per = { durabilityNegation: false, instantDeath: null };
      for (const ab of abilities) {
        if (ab.type === 'Durability Negation' && !ab.linkedTo?.length) per.durabilityNegation = true;
        if (ab.type === 'Instant Death') per.instantDeath = ab;
      }
      out.set(String(card.instanceId), per);
    }
    return out;
  };
  context[sourceKey].perCard = perCard(attackerCards);
  context[targetKey].perCard = perCard(defenderCards);
}

/* =========================
   On-Field scheduling helpers
   ========================= */

// Build a FieldCard snapshot from a played card with a Multi-Hit ability
function makeFieldCard(owner, card) {
  const abilities = getAbilities(card);
  const mh = abilities.find(a => a.type === 'Multi-Hit' && a.multiHit?.turns > 0);
  if (!mh) return null;

  // Optional: precompute DN schedule for this field card
  const dnAb = abilities.find(a => a.type === 'Durability Negation');
  let dnTurnsSet = null;
  if (dnAb?.durabilityNegation?.auto === false && dnAb.durabilityNegation.schedule) {
    const total = Math.max(1, Number(mh.multiHit.turns));
    const sch = dnAb.durabilityNegation.schedule;
    if (sch.type === 'random') {
      dnTurnsSet = new Set(pickRandomUniqueTurns(total, Math.min(total, sch.times || 1)));
    } else if (sch.type === 'list') {
      dnTurnsSet = new Set((sch.turns || []).filter(t => t >= 1 && t <= total));
    }
  }
  // Precompute per-child scheduled turns (for linked abilities with random/list schedules)
  // NOTE: overallTurn=1 is the initial play; on-field ticks use overallTurn>=2.
  const totalTurns = Math.max(1, Number(mh.multiHit.turns));
  const childTurnsByKey = {};
  for (const raw of abilities) {
    const ab = normalizeAbility(raw);
    if (!ab || ab.type === 'Multi-Hit') continue;

    // Only children linked to the primary/attack are eligible to fire on-field.
    const linked = Array.isArray(ab.linkedTo) ? ab.linkedTo : [];
    const linkedToPrimary = linked.includes('attack') || (mh.key && linked.includes(mh.key));
    if (!linkedToPrimary) continue;

    const sched = ab.multiHit?.schedule;
    if (!sched) continue; // no schedule → handled as "every on-field tick" in processor

    // Build the set of overall turns (2..totalTurns) this child should fire.
    const pool = Array.from({ length: Math.max(0, totalTurns - 1) }, (_, i) => i + 2); // [2..totalTurns]
    let turns = [];
    if (sched.type === 'list') {
      const list = Array.isArray(sched.turns) ? sched.turns : [];
      turns = list.filter(t => Number.isInteger(t) && t >= 2 && t <= totalTurns);
    } else if (sched.type === 'random') {
      const times = Math.min(pool.length, Math.max(1, Number(sched.times || 1)));
      // simple unique sampling from pool
      const bag = [...pool];
      for (let i = 0; i < times && bag.length; i++) {
        const idx = Math.floor(Math.random() * bag.length);
        turns.push(bag[idx]);
        bag.splice(idx, 1);
      }
    }
    if (turns.length) childTurnsByKey[ab.key] = turns;
  }

  // Minimal snapshot the field system needs
  const snapshot = {
    id: String(card._id || card.id || ''),
    name: card.name,
    rating: card.rating,
    spCost: Number(card.spCost ?? 0),
    potency: Number(card.potency ?? 0),
    defense: Number(card.defense ?? 0),
    // Normalize types
    types: Array.isArray(card.types) ? card.types : (card.type ? [card.type] : []),
    abilities: Array.isArray(card.abilities) ? card.abilities : []
  };
  // Trace what we pre-picked for child schedules on this snapshot
  if (Object.keys(childTurnsByKey).length) {
    console.log('[FIELD][SCHEDULES]', {
      owner, card: card?.name, iid: String(card.instanceId),
      childTurns: childTurnsByKey
    });
  }

  console.log(`[FIELD][ADD] owner=${owner} card="${card.name}" iid=${card.instanceId} turns=${mh.multiHit.turns}`);
  return {
    instanceId: String(card.instanceId),
    owner,                     // 'player' | 'enemy'
    card: snapshot,
    turnsRemaining: Math.max(0, Number(mh.multiHit.turns) - 1), // first hit was this turn
    link: mh.multiHit.link || 'attack',
    targeting: {
      mode:  mh.multiHit.targeting?.mode  || 'lock',
      scope: mh.multiHit.targeting?.scope || 'character'
    },
    targetRef: { kind: 'character' },    // default: hit the opposing character
    scheduleState: {
      turnIndex: 0,
      dnAuto: !!(dnAb && (dnAb.durabilityNegation?.auto !== false)),
      dnTurns: dnTurnsSet ? Array.from(dnTurnsSet) : null,
      childTurns: Object.keys(childTurnsByKey).length ? childTurnsByKey : null
    }
  };
}

// Run one scheduled hit for each on-field card of `sideKey`
// Returns { damageDone, onField: updatedArray, expired: { [sideKey]: CardSnapshot[] } }

/* =========================
   Helpers (pile moves)
   ========================= */
function moveCards(sourceArr, destArr, predicate) {
  const remain = [];
  for (const c of sourceArr) {
    if (predicate(c)) destArr.push(c);
    else remain.push(c);
  }
  return { remain, dest: destArr };
}
// Run one scheduled hit for each on-field card of `sideKey`.
// Returns { damageDone, onField: { player:[], enemy:[] }, expired: { [sideKey]: CardSnapshot[] } }
function processFieldHits({ sideKey, onField, attackerBase, defenderBase, buckets, retargetPrompts }) {
  const mineKey  = sideKey === 'enemy' ? 'enemy' : 'player';
  const otherKey = mineKey === 'player' ? 'enemy' : 'player';

  const mine  = Array.isArray(onField?.[mineKey])  ? onField[mineKey]  : [];
  const other = Array.isArray(onField?.[otherKey]) ? onField[otherKey] : [];
  console.log('[FIELD][STATE]', {
    side: mineKey,
    mineCount: Array.isArray(onField?.[mineKey])  ? onField[mineKey].length  : 0,
    otherCount: Array.isArray(onField?.[otherKey]) ? onField[otherKey].length : 0,
    mine:  (onField?.[mineKey]  || []).map(f => `${f.card?.name || 'Card'}#${f.instanceId}(tRem=${f.turnsRemaining})`),
    other: (onField?.[otherKey] || []).map(f => `${f.card?.name || 'Card'}#${f.instanceId}(tRem=${f.turnsRemaining})`)
  });

  let totalDamage = 0;
  const updated = [];
  const expiredMine = [];

  function resolveTargetRef(fc) {
    const targetRef  = fc?.targetRef ?? { kind: 'character' };
    const targeting  = fc?.targeting ?? { mode: 'lock', scope: 'character' };

    if (!targetRef || targetRef.kind === 'character') return targetRef;
    if (targetRef.kind === 'field') {
      const list = targetRef.side === mineKey ? mine : other;
      const exists = list.some(x => String(x.instanceId) === String(targetRef.instanceId));
      if (exists) return targetRef;

      if (targeting.mode === 'lock') return null;
      if (targeting.mode === 'retarget-random') return { kind: 'character' };
      if (targeting.mode === 'retarget-choose') {
        retargetPrompts?.push?.({
          owner: mineKey,
          instanceId: fc.instanceId,
          options: [{ kind: 'character' }]
        });
        return null;
      }
      return null;
    }
    return { kind: 'character' };
  }

  for (const fc of mine) {
    if (!fc || typeof fc.turnsRemaining !== 'number' || fc.turnsRemaining <= 0) continue;

    const resolvedTarget = resolveTargetRef(fc);
    const nextTurnIndex = (fc.scheduleState && typeof fc.scheduleState.turnIndex === 'number')
      ? fc.scheduleState.turnIndex + 1
      : 1;
    // Overall "turn number" of the multi-hit window, where 1 = the initial play hit.
    // Our first on-field tick is turn 2 overall.
    const overallTurn = nextTurnIndex + 1;

    // Should this tick bypass guard/durability due to DN?
    const dnActive = !!(fc?.scheduleState?.dnAuto) ||
      (Array.isArray(fc?.scheduleState?.dnTurns) && fc.scheduleState.dnTurns.includes(overallTurn));
    console.log('[FIELD][TICK][BEGIN]', {
      owner: mineKey,
      card: fc.card?.name, iid: fc.instanceId,
      turnIndex: nextTurnIndex, overallTurn,
      target: (resolvedTarget?.kind || 'character'),
      dnActive
    });
    const nextRemaining = fc.turnsRemaining - 1;

    // Only “character” hits are implemented here; field→field could be extended later.
    if (resolvedTarget && resolvedTarget.kind === 'character') {
      // Skip malformed entries defensively
      if (!fc?.card) {
        console.warn('[FIELD][WARN] skipping malformed onField snapshot', fc);
        // Keep it alive but don't advance turns if it's malformed
        updated.push({ ...fc, turnsRemaining: Math.max(0, fc.turnsRemaining - 1) });
        continue;
      }
      const types = Array.isArray(fc.card.types) ? fc.card.types : (fc.card.types ? [fc.card.types] : []);
      const isPhysical = types.includes('Physical');
      const isSupernatural = types.includes('Supernatural');

      // Attack side
      const atkPow  = Number(attackerBase.attackPower) || 0;
      const potency = Number(fc.card?.potency) || 0;
      const atkStat = isPhysical
        ? (Number(attackerBase.physicalPower) || 0)
        : (Number(attackerBase.supernaturalPower) || 0);

      // Defense side
      const defenderDur = dnActive ? 0 : (Number(defenderBase.durability) || 0);
      const defenderStat = isPhysical
        ? (Number(defenderBase.physicalPower) || 0)
        : (Number(defenderBase.supernaturalPower) || 0);

      const raw = (potency + atkStat) * atkPow;
      const effDef = (defenderDur * defenderStat) / 2;
      const net = Math.max(raw - effDef, 0);
      totalDamage += isNaN(net) ? 0 : net;
      if (!isNaN(net) && net > 0) {
        console.log(`[FIELD][HIT] owner=${mineKey} iid=${fc.instanceId} overallTurn=${overallTurn} dmg=${net}`);
      } else {
        console.log(`[FIELD][HIT] owner=${mineKey} iid=${fc.instanceId} overallTurn=${overallTurn} dmg=0`);
      }
      console.log('[FIELD][DMG]', {
        owner: mineKey, iid: fc.instanceId, overallTurn,
        potency, atkPow, atkStat,
        defenderDur, defenderStat,
        raw, effDef, net
      });
    }
    // Trigger child abilities scheduled for this overallTurn.
    // We only handle PERSISTENT_TYPES here; transient/on-hit accuracy/negation
    // is already accounted for in damage or DN.
    try {
      const abs = Array.isArray(fc.card?.abilities) ? fc.card.abilities : [];
      const norm = abs.map((ab, i) => normalizeAbility(ab, i));
      const primary = norm.find(a => a.type === 'Multi-Hit');
      if (primary) {
        for (const ab of norm) {
          if (ab.type === 'Multi-Hit') continue;

          // Only abilities linked to the attack/primary may fire here
          const linked = Array.isArray(ab.linkedTo) ? ab.linkedTo : [];
          const linkedToPrimary = linked.includes('attack') || (primary.key && linked.includes(primary.key));
          if (!linkedToPrimary) {
            console.log('[FIELD][AB][LINK]', {
              owner: mineKey,
              card: fc.card?.name,
              iid: fc.instanceId,
              abKey: ab.key,
              linkedTo: linked,
              primaryKey: primary.key,
              fcLink: fc.link,
              note: 'not linked to primary/attack'
            });
            continue;
          }

          // Check schedule (list or pre-picked random turns stored in scheduleState.childTurns[ab.key])
          // If no schedule is provided → fire on EVERY on-field tick by default.
          let willFire = true, scheduleInfo = { type: 'none' };
          if (ab?.multiHit?.schedule?.type === 'list') {
            const list = Array.isArray(ab.multiHit.schedule.turns) ? ab.multiHit.schedule.turns : [];
            scheduleInfo = { type: 'list', turns: list };
            willFire = list.includes(overallTurn);
          } else if (Array.isArray(fc?.scheduleState?.childTurns?.[ab.key])) {
            const pre = fc.scheduleState.childTurns[ab.key];
            scheduleInfo = { type: 'random-prepicked', turns: pre };
            willFire = pre.includes(overallTurn);
          }

          console.log('[FIELD][AB][CHK]', {
            owner: mineKey, card: fc.card?.name, iid: fc.instanceId,
            key: ab.key, type: ab.type, overallTurn, schedule: scheduleInfo, willFire
          });

          if (!willFire) {
            console.log('[FIELD][AB][SKIP]', {
              owner: mineKey, card: fc.card?.name, iid: fc.instanceId,
              key: ab.key, type: ab.type, overallTurn, schedule: scheduleInfo,
              note: 'schedule did not include this turn'
            });
            continue;
          }

          // Determine owner/target buckets
          const mine = mineKey;
          const other = otherKey;
          const targetsOpponent = (
            ab.type === 'Stats Down' || ab.type === 'Freeze' || ab.type === 'Unluck' ||
            ab.type === 'Curse' || ab.type === 'Ability Negation' || ab.type === 'Instant Death' ||
            ab.type === 'Durability Negation'
          );
          const dest = targetsOpponent ? other : mine;

          // For stat buffs/debuffs, resolve target stat if needed
          const entry = { ...ab };
          if (ab.type === 'Stats Up' || ab.type === 'Stats Down') {
            entry.target = resolveStatTarget(ab, { types: fc.card.types });
          }

          console.log('[FIELD][AB][FIRE]', {
            owner: mineKey, dest, key: ab.key, type: ab.type,
            overallTurn, power: entry.power, duration: entry.duration, precedence: entry.precedence
          });
          upsertPersistentEffect(buckets[dest], entry, dest);
          console.log(`[FIELD][AB] fired ${ab.type} (key=${ab.key}) on turn=${overallTurn} → ${dest}`);
        }
      }
    } catch (e) {
      console.error('[FIELD][AB][ERR]', e);
    }

    // Carry forward or expire
    const carry = {
      ...fc,
      turnsRemaining: nextRemaining,
      scheduleState: { ...(fc.scheduleState || {}), turnIndex: nextTurnIndex }
    };
    console.log('[FIELD][TICK][END]', {
      owner: mineKey, iid: fc.instanceId, overallTurn,
      damageSoFar: totalDamage,
      nextTurnsRemaining: nextRemaining
    });
    if (nextRemaining > 0) updated.push(carry);
    else expiredMine.push({ ...fc, turnsRemaining: 0 });
  }

  const onFieldOut = {
    player: mineKey === 'player' ? updated : (Array.isArray(onField?.player) ? onField.player : []),
    enemy : mineKey === 'enemy'  ? updated : (Array.isArray(onField?.enemy ) ? onField.enemy  : [])
  };
  console.log('[FIELD][SUMMARY]', {
    side: mineKey,
    damageDone: totalDamage,
    updatedCount: updated.length,
    expiredCount: expiredMine.length
  });

  return { damageDone: totalDamage, onField: onFieldOut, expired: { [mineKey]: expiredMine } };
}
/* =========================
   Controllers
   ========================= */

const saveState = async (req, res) => {
  try {
    const userId = req.user._id;
    const gameData = req.body || {};
    if (!Object.keys(gameData).length) {
      return res.status(400).json({ message: 'No game data provided' });
    }

    let savedGame = await SavedGame.findOne({ user: userId });
    if (!savedGame) savedGame = new SavedGame({ user: userId });

    // Shallow merge incoming data
    Object.assign(savedGame, gameData);

    // --- BRIDGE: keep legacy fields in sync with the new progress block ---
    const p = gameData.progress || {};
    // Mirror room index
    if (typeof p.roomIndex === 'number') {
      savedGame.roomIndex = p.roomIndex;
      // ensure we keep any existing progress fields
      savedGame.progress = { ...(savedGame.progress || {}), ...p };
    }
    // Mirror generated path to legacy campaign array for older readers
    if (Array.isArray(p.generatedPath) && p.generatedPath.length) {
      savedGame.campaign = p.generatedPath;
      savedGame.progress = { ...(savedGame.progress || {}), generatedPath: p.generatedPath };
    }
    if (p.campaignId) {
      savedGame.progress = { ...(savedGame.progress || {}), campaignId: p.campaignId };
    }

    await savedGame.save();
    return res.json({ message: 'Game state updated', savedGame });
  } catch (err) {
    console.error('[GAME_CONTROLLER][SAVE_STATE]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const loadState = async (req, res) => {
  try {
    const userId = req.user._id;
    const savedGame = await SavedGame.findOne({ user: userId });
    if (!savedGame) {
      return res.status(404).json({ message: 'No saved game found' });
    }
    res.json(savedGame);
  } catch (err) {
    console.error('[GAME_CONTROLLER][LOAD_STATE]', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const clearState = async (req, res) => {
  try {
    const userId = req.user._id;
    const removed = await SavedGame.findOneAndDelete({ user: userId });
    if (!removed) {
      return res.status(404).json({ message: 'No saved game found' });
    }
    return res.json({ ok: true, message: 'Saved game cleared' });
  } catch (err) {
    console.error('[GAME_CONTROLLER][CLEAR_STATE]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const playTurn = async (req, res) => {
  try {
    const {
      selectedCards = [],
      playerStats: playerStatsIn,
      enemyId,
      action,
      enemyStats: enemyStatsIn,

      hand:        clientHand        = [],
      deck:        clientDeck        = [],
      discardPile: clientDiscard     = [],

      enemyHand:   clientEnemyHand   = [],
      enemyDeck:   clientEnemyDeck   = [],
      enemyDiscard: clientEnemyDiscard = [],

      campaignId,
      activeEffects: incomingActiveEffects = null,
      onField: incomingOnField = { player: [], enemy: [] },
      retargetChoices = [],
      negationTarget = null,
    } = req.body;
    const saved = await SavedGame.findOne({ user: req.user._id }).lean();
    const defaultStats = {
      attackPower:        10,
      supernaturalPower:  10,
      physicalPower:      10,
      durability:         10,
      vitality:            1,
      intelligence:        1,
      speed:               5,
      sp:                  3,
      maxSp:               5,
    };

    // Overlay campaign initial stats (if campaignId present)
    try {
      const camp = campaignId
        ? await Campaign.findById(campaignId, { 'playerSetup.initialStats': 1 }).lean()
        : null;
      const base = camp?.playerSetup?.initialStats;
      if (base && typeof base === 'object') {
        for (const k of Object.keys(base)) {
          if (k === 'hp') continue; // hp derived below unless FE provided hpRemaining
          if (typeof base[k] === 'number') defaultStats[k] = Number(base[k]);
        }
      }
    } catch {}

    // Add run-time extraStats from SavedGame (can be negative)
    const extra = (saved && typeof saved.extraStats === 'object') ? saved.extraStats : {};
    for (const [k, delta] of Object.entries(extra)) {
      if (typeof delta === 'number') {
        defaultStats[k] = Number(defaultStats[k] ?? 0) + delta;
      }
    }

    let playerStats = { ...(playerStatsIn || {}) };
    for (const key of Object.keys(defaultStats)) {
      const v = playerStats[key];
      if (typeof v !== 'number' || Number.isNaN(v)) {
        playerStats[key] = defaultStats[key];
      }
    }
    try { console.log('[HP][PLAYER][VIT-BEFORE]', Number(playerStats?.vitality) || 0, 'incomingHp=', playerStats?.hp); } catch {}
    // prefer an hp derived from vitality if none provided
    if (
      typeof playerStats.hp !== 'number' ||
      Number.isNaN(playerStats.hp) ||
      playerStats.hp <= 0
    ) {
      playerStats.hp = Math.max(1, (Number(playerStats.vitality) || 1) * 100);
    }
    try { console.log('[HP][PLAYER][HP-AFTER]', playerStats.hp); } catch {}
    let enemyStats = { ...(enemyStatsIn || {}) };
    for (const key of Object.keys(defaultStats)) {
      if (key === 'hp') continue; // do not seed HP with 100
      const v = enemyStats[key];
      if (typeof v !== 'number' || Number.isNaN(v)) {
        enemyStats[key] = defaultStats[key];
      }
    }
        // --- Seed player piles from campaign (fresh run only) ---
    let hand = Array.isArray(clientHand) ? clientHand.slice() : [];
    let deck = Array.isArray(clientDeck) ? clientDeck.slice() : [];
    let discardPile = Array.isArray(clientDiscard) ? clientDiscard.slice() : [];
    let bootstrappedPlayer = false;
    let bootstrappedEnemy  = false;

    if ((!deck.length && !hand.length) && campaignId) {
      const camp = await Campaign.findById(campaignId).lean();
      const entries = Array.isArray(camp?.playerSetup?.startingDeck) ? camp.playerSetup.startingDeck : [];
      if (entries.length) {
        // pull only the IDs we need
        const ids = entries.map(e => e?.cardId).filter(Boolean);
        const cards = await Card.find({ _id: { $in: ids } }).lean();
        const byId = new Map(cards.map(c => [String(c._id), c]));

        // expand deck by quantity
        deck = [];
        for (const e of entries) {
          const base = byId.get(String(e.cardId));
          if (!base) continue;
          const qty = Math.max(1, Math.min(30, Number(e.qty || 1)));
          for (let i = 0; i < qty; i++) {
            deck.push({
              id: String(base._id),
              name: base.name,
              type: base.type || base.types,
              rating: base.rating,
              spCost: base.spCost ?? 0,
              potency: base.potency ?? 0,
              defense: base.defense ?? 0,
              abilities: base.abilities || [],
              defaultAttackType: base.defaultAttackType || 'Single',
            });
          }
        }

        
        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        // Draw starting hand
        const drawN = Math.min(Number(camp?.playerSetup?.startingHandSize ?? 5), deck.length);
        hand = deck.splice(0, drawN);
        bootstrappedPlayer = true;
        discardPile = [];
      }
    }

    // Merge run-only extraDeck from SavedGame
    const bonus = Array.isArray(saved?.extraDeck) ? saved.extraDeck : [];
    if (bonus.length) {
      // If entries are { cardId, qty }, expand by qty and push minimal DTOs into deck
      const idQty = bonus
        .filter(e => e && e.cardId)
        .map(e => ({ id: String(e.cardId), qty: Math.max(1, e.qty || 1) }));

      // Fetch card docs once, then expand
      const ids = [...new Set(idQty.map(e => e.id))];
      const cards = await Card.find({ _id: { $in: ids } }).lean();

      const byId = new Map(cards.map(c => [String(c._id), c]));
      for (const { id, qty } of idQty) {
        const c = byId.get(id);
        if (!c) continue;
        for (let i = 0; i < qty; i++) {
          deck.push({
            id, name: c.name, type: c.type || c.types, rating: c.rating,
            spCost: c.spCost ?? 0, potency: c.potency ?? 0, defense: c.defense ?? 0,
            abilities: Array.isArray(c.abilities) ? c.abilities : [],
            defaultAttackType: c.defaultAttackType || 'Single',
          });
        }
      }
    }

    // Extra guard-logs (requested)
    console.log('[REQ][TURN]', {
      action,
      selectedCardsCount: Array.isArray(selectedCards) ? selectedCards.length : 0,
      incomingActiveEffectsLen: { player: incomingActiveEffects?.player?.length || 0, enemy: incomingActiveEffects?.enemy?.length || 0 },
      onFieldSlots: { player: incomingOnField?.player?.length || 0, enemy: incomingOnField?.enemy?.length || 0 },
    });

    for (const key of Object.keys(defaultStats)) {
      if (key === 'hp') continue; // do not default HP; let it derive from vitality if missing
      if (typeof playerStats[key] !== 'number' || Number.isNaN(playerStats[key])) {
        playerStats[key] = defaultStats[key];
      }
    }

    playerStats.sp = playerStats.sp ?? defaultStats.sp;

    const enemy = await Enemy.findById(enemyId).populate('moveSet');
    if (!enemy) {
      return res.status(404).json({ message: 'Enemy not found' });
    }
    // [AI][INIT] — enemy meta & moveset
    console.log('[AI][INIT]', {
      enemyId,
      enemyName: enemy.name,
      moveSetCount: Array.isArray(enemy.moveSet) ? enemy.moveSet.length : 0,
      moveSetIds: Array.isArray(enemy.moveSet) ? enemy.moveSet.map(c => (c._id || c).toString()) : 'n/a'
    });

    const persistedEnemyStats =
      saved?.result?.enemy || saved?.enemyStats || null;

    const hasHpFromClient    = typeof enemyStatsIn?.hp    === 'number';
    const hasHpRemainingFromClient = typeof enemyStatsIn?.hpRemaining === 'number';
    const hasSpFromClient    = typeof enemyStatsIn?.sp    === 'number';
    const hasMaxSpFromClient = typeof enemyStatsIn?.maxSp === 'number';

    if (persistedEnemyStats) {
      if (!hasHpFromClient    && typeof persistedEnemyStats.hp    === 'number') enemyStats.hp    = persistedEnemyStats.hp;
      if (!hasSpFromClient    && typeof persistedEnemyStats.sp    === 'number') enemyStats.sp    = persistedEnemyStats.sp;
      if (!hasMaxSpFromClient && typeof persistedEnemyStats.maxSp === 'number') enemyStats.maxSp = persistedEnemyStats.maxSp;
    }
    // Ensure vitality is present: prefer FE -> Enemy doc -> persisted -> default(1)
    const hasVitFromClient = typeof enemyStatsIn?.vitality === 'number' && !Number.isNaN(enemyStatsIn.vitality);
    if (!hasVitFromClient) {
      const docVit = Number(enemy?.stats?.vitality ?? enemy?.vitality);
      const persistedVit = Number(persistedEnemyStats?.vitality);
      if (Number.isFinite(docVit) && docVit > 0) {
        enemyStats.vitality = docVit;
      } else if (Number.isFinite(persistedVit) && persistedVit > 0) {
        enemyStats.vitality = persistedVit;
      }
    }

    const baseEnemyHp = Math.max(1, (Number(enemyStats.vitality) || 1) * 100);
    let enemyHp;
    if (hasHpFromClient || hasHpRemainingFromClient) {
      enemyHp = Math.max(1, Number(hasHpFromClient ? enemyStatsIn.hp : enemyStatsIn.hpRemaining));
    } else if (typeof persistedEnemyStats?.hp === 'number' && !Number.isNaN(persistedEnemyStats.hp)) {
      enemyHp = Math.max(1, Number(persistedEnemyStats.hp));
    } else {
      enemyHp = baseEnemyHp; // ← default to vitality-based HP when FE didn’t send hp/hpRemaining
    }
    enemyStats.hp = enemyHp; // keep normalized struct consistent downstream/logs

    let enemySp = typeof enemyStats.sp === 'number' ? enemyStats.sp : defaultStats.sp;
    // --- HP/VIT TRACE (normalized inputs) ---
    console.log('[HP][IN]', {
      player: {
        vit_in:        playerStatsIn?.vitality,
        vit_normalized: playerStats.vitality,
        hp_in:         playerStatsIn?.hp,
        hp_normalized: playerStats.hp
      },
      enemy: {
        vit_in:         enemyStatsIn?.vitality,
        vit_normalized: enemyStats.vitality,
        hp_in:          enemyStatsIn?.hp,
        hp_in_rem:      enemyStatsIn?.hpRemaining,   // <— new: shows FE echo
        hp_normalized:  enemyStats.hp,
        baseEnemyHp,
        chosenHp:       enemyHp
      }
    });

    let oldPlayerHand = hand;
    let playerDeck    = deck;
    let playerDiscard = discardPile;

    let oldEnemyHand  = Array.isArray(clientEnemyHand) ? clientEnemyHand : [];
    let enemyDeck     = Array.isArray(clientEnemyDeck) ? clientEnemyDeck : [];
    let enemyDiscard  = Array.isArray(clientEnemyDiscard) ? clientEnemyDiscard : [];
    const wasProvidedEmptyEnemyPiles = !clientEnemyHand.length && !clientEnemyDeck.length;

    // (Re)initialize enemy deck/hand if empty
    if ((!oldEnemyHand.length && !enemyDeck.length) || !Array.isArray(oldEnemyHand) || !Array.isArray(enemyDeck)) {
      const moveSetDocs = await Card.find({ _id: { $in: enemy.moveSet } });
      const shuffled = [...moveSetDocs].sort(() => Math.random() - 0.5);
      oldEnemyHand = shuffled.slice(0, HAND_SIZE).map((c, i) => ({ ...c.toObject(), instanceId: i + 1 }));
      enemyDeck = shuffled.slice(HAND_SIZE).map((c, i) => ({ ...c.toObject(), instanceId: HAND_SIZE + i + 1 }));
      enemyDiscard = [];
      // [AI][BUILD] — after rebuild
      console.log('[AI][BUILD]', {
        reason: (!clientEnemyHand.length && !clientEnemyDeck.length) ? 'empty hand+deck' : 'invalid arrays',
        fetchedDocs: moveSetDocs.length,
        handNames: oldEnemyHand.map(c => c.name),
        deckCount: enemyDeck.length,
        discardCount: enemyDiscard.length
      });
      bootstrappedEnemy = wasProvidedEmptyEnemyPiles;
    }

    // load persistent effect buckets from request (or start fresh)
    const effectBuckets = loadActiveBuckets(incomingActiveEffects || { player: [], enemy: [] });

    // NEW: on-field containers (defensive defaults)
    let onField = {
      player: Array.isArray(incomingOnField?.player) ? incomingOnField.player : [],
      enemy:  Array.isArray(incomingOnField?.enemy)  ? incomingOnField.enemy  : [],
    };
    onField.player = onField.player.slice(0, MAX_FIELD_SLOTS);
    onField.enemy  = onField.enemy.slice(0, MAX_FIELD_SLOTS);

    // NEW: log snapshot of what we loaded from FE echo
    {
      const snap = (map) => Array.from(map.entries()).map(([k,e]) => `${k}[${e.remaining}]`).join(', ');
      console.log('[PERSIST][LOAD]', {
        player: snap(effectBuckets.player),
        enemy:  snap(effectBuckets.enemy),
      });
    }

    // [STATE][LOAD] — what server loaded as persistent state
    console.log('[STATE][LOAD]', {
      effectsInPlayer: (incomingActiveEffects?.player || []).map(e => `${e.type}${e.target?`(${e.target})`:''}[${e.remaining ?? '?'}]`),
      effectsInEnemy:  (incomingActiveEffects?.enemy  || []).map(e => `${e.type}${e.target?`(${e.target})`:''}[${e.remaining ?? '?'}]`),
      onFieldIn: {
        player: (onField.player || []).map(f => `${f.card?.name}#${f.instanceId}(tRem=${f.turnsRemaining})`),
        enemy:  (onField.enemy  || []).map(f => `${f.card?.name}#${f.instanceId}(tRem=${f.turnsRemaining})`),
      }
    });

    // NEW: apply UI retarget choices early
    function applyRetargetChoices(onFieldIn, choices) {
      const idxBySide = {
        player: new Map((onFieldIn.player || []).map((f,i)=>[String(f.instanceId), i])),
        enemy:  new Map((onFieldIn.enemy  || []).map((f,i)=>[String(f.instanceId), i])),
      };
      for (const ch of (choices || [])) {
        const side = (ch.owner === 'enemy') ? 'enemy' : 'player';
        const idx = idxBySide[side].get(String(ch.instanceId));
        if (idx == null) continue;
        onFieldIn[side][idx].targetRef = ch.targetRef; // { kind:'character' | 'field', side:'player'|'enemy', instanceId? }
      }
    }
    applyRetargetChoices(onField, retargetChoices);

    /* =========================
       Process existing Player on-field hits (start of player turn)
       ========================= */
    let playerHp    = playerStats.hp;
    let playerSp    = playerStats.sp;
    let playerSpeed = playerStats.speed;

    let playerBuffDef = 0;
    let message   = '';
    let defendUsed = false;
    let enemyBuffDef = 0;
    // NEW: collect prompts to return to UI
    const retargetPrompts = [];

    // Player on-field activations (skip if frozen)
    const playerFrozenPersist = Array.from(effectBuckets.player.values()).some(
      e => e.type === 'Freeze' && e.remaining > 0
    );
    if (playerFrozenPersist) console.log('[FREEZE][GATE] player main action is frozen (remaining > 0)');

    const pf = processFieldHits({
      sideKey: 'player',
      onField,
      attackerBase: playerStats,
      defenderBase: enemyStats,
      buckets: effectBuckets,
      retargetPrompts
    });
    console.log('[FIELD][RET]', { side: 'player', damageDone: pf.damageDone, expired: pf.expired?.player?.length || 0 });
    // Guard: never let on-field expiry raise enemy HP
    const enemyHp_beforePlayerField = enemyHp;

    onField = pf.onField;
    if (pf.damageDone > 0) enemyHp = Math.max(0, enemyHp - pf.damageDone);
    // recycle expired on-field snapshots back to deck
    if (pf.expired?.player?.length) {
      // Rebuild proper deck cards from field snapshots
      const returned = pf.expired.player.map(fc => ({ ...fc.card, instanceId: fc.instanceId }));
      playerDeck = [...playerDeck, ...returned];
      console.log(`[FIELD][RECYCLE] player +${pf.expired.player.length} → deck`);
    }
    // If somehow HP went up during on-field expiry handling, clamp it back
    if (enemyHp > enemyHp_beforePlayerField) {
      console.warn('[FIELD][BUGFIX] enemy HP increased after player on-field expiry; clamping', {
        before: enemyHp_beforePlayerField, after: enemyHp
      });
      enemyHp = enemyHp_beforePlayerField;
    }
    // revive handling unchanged...
    if (enemyHp <= 0 && effectBuckets.enemy.has('Revive')) {
      const eff = effectBuckets.enemy.get('Revive');
      const pct = clamp(eff.power, 0, 100);
      enemyHp = Math.max(1, Math.floor((enemyStats.vitality * 100) * (pct / 100)));
      effectBuckets.enemy.delete('Revive');
    }

    /* =========================
       PLAYER TURN main action
       ========================= */

    // --- helpers: normalize selection as full card objects ---
    function normalizeSelectedCards(selected, hand) {
      if (!Array.isArray(selected)) return [];
      if (selected.length && typeof selected[0] === 'object' && 'instanceId' in selected[0]) {
        return selected;
      }
      const byId = new Map((hand || []).map(c => [String(c.instanceId), c]));
      return selected.map(iid => byId.get(String(iid))).filter(Boolean);
    }

    const playedPlayerCards = normalizeSelectedCards(selectedCards, oldPlayerHand);
    const playedPlayerCardsIds = new Set(playedPlayerCards.map(c => String(c.instanceId)));
    const playerCards = playedPlayerCards;

    const totalPlayerSpCost = playerCards.reduce((sum, card) => {
      const cost = (typeof card.spCost === 'number') ? card.spCost : 0;
      return sum + cost;
    }, 0);

    // Forced skip if frozen (no SP change)
    // If FE sends a no-op right after seed (no action, no selected cards), do not advance to enemy.
    if (!action && (!selectedCards || selectedCards.length === 0)) {
      const respNoop = {
        ok: true,
        result: {
          player: {
            hp: playerHp,
            sp: playerSp,
            hand: oldPlayerHand,
            deck: playerDeck,
            discard: playerDiscard,
            message: null,
          },
          enemy: {
            hp: enemyHp,
            sp: enemySp,
            hand: oldEnemyHand,
            deck: enemyDeck,
            discard: enemyDiscard,
            message: null,
          },
          activeEffects: dumpActiveBuckets(effectBuckets),
          onField,
          playerIsDead: playerHp <= 0,
          enemyIsDead: enemyHp <= 0,
          retargetPrompts,
        }
      };
      console.log('[RESP][HP]', {
        ctx: 'noop',
        playerVit: playerStats.vitality,
        playerHp:  respNoop.result.player.hp ?? respNoop.result.player.hpRemaining,
        enemyVit:  enemyStats.vitality,
        enemyHp:   respNoop.result.enemy.hp  ?? respNoop.result.enemy.hpRemaining
      });
      return res.json(respNoop);
    }
    if (playerFrozenPersist) {
      console.log('[FREEZE][AUTOSKIP]', { owner: 'player' });
      console.log('[FREEZE][GATE]', { owner: 'player', blockedAction: action });
      message = 'You are frozen and cannot act this turn.';
    } else if (action === 'play' || (!action && playerCards.length > 0)) {
      if (totalPlayerSpCost > playerSp) {
        return res.status(400).json({ message: 'Not enough SP to play selected cards.' });
      }

      // add card-level defense to this turn
      for (const card of playerCards) {
        if (typeof card.defense === 'number' && !isNaN(card.defense)) {
          playerBuffDef += card.defense;
        }
      }

      // Build temp stats & context
      const playerTempStats = { ...playerStats };
      const enemyTempStats  = { ...enemyStats };

      const ctx = {
        player: {
          effects: [],
          chanceUp: 0,
          chanceDown: 0,
          abilityShield: { active: false, precedence: 0, duration: 0 },
          guard: { active: false, precedence: 0, duration: 0 },
          frozenTurns: 0,
          curseSuppress: 0,
          perCard: new Map(),
          revive: null,
        },
        enemy: {
          effects: [],
          chanceUp: 0,
          chanceDown: 0,
          abilityShield: { active: false, precedence: 0, duration: 0 },
          guard: { active: false, precedence: 0, duration: 0 },
          frozenTurns: 0,
          curseSuppress: 0,
          perCard: new Map(),
          revive: null,
        },
      };

      // apply carryover persistent effects
      applyPersistentToContext({ sideKey: 'player', buckets: effectBuckets, tempStats: playerTempStats, ctx });
      applyPersistentToContext({ sideKey: 'enemy',  buckets: effectBuckets, tempStats: enemyTempStats,  ctx });

      // PRE-DAMAGE: apply new abilities & merge persistent (attack-linked are deferred)
      const attackLinkedMap = new Map(); // instanceId -> [{card,ability,owner,target}]
      applyAbilityPreDamagePhase({
        attackerBase: playerStats, defenderBase: enemyStats,
        attackerTemp: playerTempStats, defenderTemp: enemyTempStats,
        attackerCards: playerCards, defenderCards: [],
        context: ctx,
        buckets: effectBuckets,
        sourceKey: 'player',
        targetKey: 'enemy',
        attackLinkedOut: attackLinkedMap
      });

      // Handle Ability Negation targeting on-field (if any negation triggered)
      if (negationTarget && attackLinkedMap) {
        const trgOwner = (negationTarget.owner === 'player' || negationTarget.owner === 'enemy') ? negationTarget.owner : 'enemy';
        const instanceId = String(negationTarget.instanceId);
        if (trgOwner === 'enemy' && Array.isArray(onField.enemy)) {
          onField.enemy = onField.enemy.filter(fc => String(fc.instanceId) !== instanceId);
        } else if (trgOwner === 'player' && Array.isArray(onField.player)) {
          onField.player = onField.player.filter(fc => String(fc.instanceId) !== instanceId);
        }
      }

      // INSTANT DEATH (player → enemy), before damage, with INT (from perCard flags)
      for (const card of playerCards) {
        const per = ctx.player.perCard.get(String(card.instanceId));
        if (!per) continue;
        if (per.instantDeath && !ctx.enemy.abilityShield.active) {
          const ab = per.instantDeath;
          const base = clamp((ab.activationChance ?? 100) + ctx.player.chanceUp - ctx.enemy.chanceDown, 0, 100);
          const finalChance = intMult(base, playerTempStats.intelligence);
          if (roll(finalChance)) enemyHp = 0;
        }
      }
      if (enemyHp <= 0 && effectBuckets.enemy.has('Revive')) {
        const eff = effectBuckets.enemy.get('Revive');
        const pct = clamp(eff.power, 0, 100);
        enemyHp = Math.max(1, Math.floor((enemyStats.vitality * 100) * (pct / 100)));
        effectBuckets.enemy.delete('Revive');
      }

      // spend SP
      playerSp -= totalPlayerSpCost;

      // DAMAGE (respect Guard, Durability Negation (incl. attack-linked), and Dodge)
      let totalNetDamageToEnemy = 0;
      for (const card of playerCards) {
        const types = getTypes(card);
        if (!types.includes('Physical') && !types.includes('Supernatural')) continue;

        // Durability Negation either explicit flag OR via attack-linked abilities that include DN
        const per = ctx.player.perCard.get(String(card.instanceId));
        let bypassGuard = per?.durabilityNegation === true;

        const attackLinkedList = attackLinkedMap.get(String(card.instanceId)) || [];
        if (!bypassGuard && attackLinkedList.length) {
          if (attackLinkedList.some(x => x.ability.type === 'Durability Negation')) {
            bypassGuard = true;
          }
        }

        const guardActive = ctx.enemy.guard.active;
        if (guardActive && !bypassGuard) continue;
        if (willDodge(playerTempStats, enemyTempStats, ctx, 'player', 'enemy')) continue;

        const potency = Number(card.potency) || 0;
        const powerStat = types.includes('Physical')
          ? (Number(playerTempStats.physicalPower) || 0)
          : (Number(playerTempStats.supernaturalPower) || 0);

        const effAtkPow = Number(playerTempStats.attackPower) || 0;
        const rawDamage = (potency + powerStat) * effAtkPow;

        const defenderDurability = bypassGuard ? 0
          : ((Number(enemyTempStats.durability) || 0) + (enemyBuffDef || 0));
        const defenderPowerStat = types.includes('Physical')
          ? (Number(enemyTempStats.physicalPower) || 0)
          : (Number(enemyTempStats.supernaturalPower) || 0);
        const effDefenseEnemy = ((defenderDurability) * defenderPowerStat) / 2;

        const netDamage = Math.max(rawDamage - effDefenseEnemy, 0);
        totalNetDamageToEnemy += isNaN(netDamage) ? 0 : netDamage;
      }

      enemyHp = Math.max(0, enemyHp - totalNetDamageToEnemy);

      // --- Schedule Multi-Hit cards onto the field (after resolving current hit) ---
      for (const card of playerCards) {
        const abilities = getAbilities(card);
        const mh = abilities.find(a => a.type === 'Multi-Hit' && a.multiHit?.turns > 0);
        if (mh && onField.player.length < MAX_FIELD_SLOTS) {
          const fieldCard = makeFieldCard('player', card);
          if (fieldCard) onField.player.push(fieldCard);
        }
      }

      message = (totalNetDamageToEnemy > 0)
        ? `You dealt ${Math.floor(totalNetDamageToEnemy)} damage.`
        : 'No damage dealt this turn.';

      if (enemyHp <= 0 && effectBuckets.enemy.has('Revive')) {
        const eff = effectBuckets.enemy.get('Revive');
        const pct = clamp(eff.power, 0, 100);
        enemyHp = Math.max(1, Math.floor((enemyStats.vitality * 100) * (pct / 100)));
        effectBuckets.enemy.delete('Revive');
      }

    } else if (action === 'skip' || action === 'defend') {
      // New mechanics will manage piles below; keep only SP/message/flags here.
      if (action === 'skip') {
        playerSp = Math.min(playerStats.maxSp, playerSp + 2);
        message = 'Skipped turn. +2 SP recovered.';
      } else {
        playerSp = Math.min(playerStats.maxSp, playerSp + 1);
        defendUsed = true;
        message = 'Defended. +1 SP and damage received halved.';
      }
    }
    // Helper: does this card have an active Multi-Hit?
    const hasMultiHit = (card) =>
      (getAbilities(card) || []).some(a => a.type === 'Multi-Hit' && a.multiHit?.turns > 0);

    // --- RETURN CARDS LOGIC (new) ---
    let newPlayerHand    = [...oldPlayerHand];
    let newPlayerDeck    = [...playerDeck];
    let newPlayerDiscard = [...playerDiscard];

    try {
      if (action === 'play') {
        // Which cards were played this turn?
        const played = oldPlayerHand.filter(c => playedPlayerCardsIds.has(String(c.instanceId)));
        const playedNoMH  = played.filter(c => !hasMultiHit(c));
        const playedWithMH = played.filter(c =>  hasMultiHit(c));

        // Remove all played cards from hand
        let h = oldPlayerHand.filter(c => !playedPlayerCardsIds.has(String(c.instanceId)));

        // Only NON-Multi-Hit cards go back to the deck
        let d = [...playerDeck, ...playedNoMH];

        newPlayerHand = h;
        newPlayerDeck = d;

        // Stash the Multi-Hit we’ll schedule in the next step
        req._playedWithMH = playedWithMH;

        console.log('[PILE][PLAY] return -> deck (non-MH):', playedNoMH.length, '| schedule MH:', playedWithMH.length);
      } else if (action === 'defend') {
        // NOTHING returns
        console.log('[PILE][DEFEND] no-op (keep hand)');
      } else if (action === 'skip') {
        // ENTIRE hand returns to deck
        const { remain, dest } = moveCards(
          newPlayerHand,
          newPlayerDeck,
          _c => true
        );
        newPlayerHand = remain; // becomes []
        newPlayerDeck = dest;
        console.log('[PILE][SKIP] hand -> deck:', newPlayerDeck.length - playerDeck.length);
      } else {
        console.log('[PILE][OTHER] action=', action);
      }
    } catch (e) {
      console.error('[PILE][ERR]', e);
      throw e; // surface as 500 with our label
    }

    // --- DRAW up to target hand size (use global HAND_SIZE) ---
    while (newPlayerHand.length < HAND_SIZE && newPlayerDeck.length > 0) {
      newPlayerHand.push(newPlayerDeck.shift());
    }

    // write back piles into variables used later/response
    oldPlayerHand = newPlayerHand;
    playerDeck    = newPlayerDeck;
    playerDiscard = newPlayerDiscard;
    // --- schedule player's multi-hit cards to the field (if any) ---
    const MAX_SLOTS = MAX_FIELD_SLOTS;
    if (!onField || typeof onField !== 'object') onField = { player: [], enemy: [] };
    if (!Array.isArray(onField.player)) onField.player = [];
    if (!Array.isArray(onField.enemy))  onField.enemy  = [];

    const existingIds = new Set((onField.player || []).map(f => String(f.instanceId)));
    const mhToSchedule = Array.isArray(req._playedWithMH) ? req._playedWithMH : [];

    const capacity = Math.max(0, MAX_SLOTS - onField.player.length);
    const toAdd = mhToSchedule.filter(c => !existingIds.has(String(c.instanceId))).slice(0, capacity);
    const overflow = mhToSchedule.filter(c => !existingIds.has(String(c.instanceId))).slice(capacity);

    // Add field snapshots
    for (const c of toAdd) {
      const snap = makeFieldCard('player', c);
      if (snap) onField.player = [...onField.player, snap];
    }

    // Anything that couldn't fit goes back to the deck (so we don’t lose the card)
    if (overflow.length) {
      newPlayerDeck = [...newPlayerDeck, ...overflow];
      console.log('[FIELD][CAP] player overflow', overflow.length, '→ returned to deck');
    }

    // ====== BOOT SEED: draw starting hand but DO NOT advance the round ======
    // Triggered when FE sends { seed: true } (action string is ignored here).
    const autoSeed = bootstrappedPlayer || bootstrappedEnemy;
    if (req.body?.seed === true || autoSeed) {
      console.log(autoSeed
        ? '[SEED][AUTO] boot: initial draw only; skipping enemy/round advance'
        : '[SEED] boot: initial draw only; skipping enemy/round advance');

      const respSeed = {
        ok: true,
        result: {
          player: { hp: playerHp, sp: playerSp, hand: oldPlayerHand, deck: playerDeck, discard: playerDiscard, message: null },
          enemy:  { hp: enemyHp,  sp: enemySp,  hand: oldEnemyHand,  deck: enemyDeck,  discard: enemyDiscard,  message: null },
          activeEffects: dumpActiveBuckets(effectBuckets),
          onField,
          playerIsDead: playerHp <= 0,
          enemyIsDead: enemyHp <= 0,
          retargetPrompts,
        }
      };
      console.log('[RESP][HP]', {
        ctx: 'seed',
        playerVit: playerStats.vitality,
        playerHp:  respSeed.result.player.hp ?? respSeed.result.player.hpRemaining,
        enemyVit:  enemyStats.vitality,
        enemyHp:   respSeed.result.enemy.hp  ?? respSeed.result.enemy.hpRemaining
      });
      return res.json(respSeed);
    }
    /* =========================
       ENEMY TURN (if alive)
       ========================= */

    // Enemy on-field activations (skip if frozen), BEFORE choosing action
    enemyBuffDef    = 0;
    let enemyBuffs      = [];

    // Enemy on-field activations (always run; Freeze only blocks enemy main action)
    const enemyFrozenPersist = Array.from(effectBuckets.enemy.values()).some(
      e => e.type === 'Freeze' && e.remaining > 0
    );
    if (enemyFrozenPersist) console.log('[FREEZE][GATE] enemy main action is frozen (remaining > 0)');
    const playerHp_beforeEnemyField = playerHp;
    if (enemyHp > 0) {
      const ef = processFieldHits({
        sideKey: 'enemy',
        onField,
        attackerBase: enemyStats,
        // Defense from your played cards applies when YOU are the defender
        defenderBase: { ...playerStats, durability: (playerStats.durability || 0) + (playerBuffDef || 0) },
        buckets: effectBuckets,
        retargetPrompts
      });
      console.log('[FIELD][RET]', { side: 'enemy', damageDone: ef.damageDone, expired: ef.expired?.enemy?.length || 0 });
      onField = ef.onField;
      if (ef.damageDone > 0) {
        playerHp = Math.max(0, playerHp - ef.damageDone);
        if (playerHp <= 0 && effectBuckets.player.has('Revive')) {
          const eff = effectBuckets.player.get('Revive');
          const pct = clamp(eff.power, 0, 100);
          playerHp = Math.max(1, Math.floor((playerStats.vitality * 100) * (pct / 100)));
          effectBuckets.player.delete('Revive');
        }
      }
      // recycle expired on-field snapshots back to deck
      if (ef.expired?.enemy?.length) {
        const returnedE = ef.expired.enemy.map(fc => ({ ...fc.card, instanceId: fc.instanceId }));
        enemyDeck = [...enemyDeck, ...returnedE];
        console.log(`[FIELD][RECYCLE] enemy +${ef.expired.enemy.length} → deck`);
      }
      // If somehow HP went up during on-field expiry handling, clamp it back
      if (playerHp > playerHp_beforeEnemyField) {
        console.warn('[FIELD][BUGFIX] player HP increased after enemy on-field expiry; clamping', {
          before: playerHp_beforeEnemyField, after: playerHp
        });
        playerHp = playerHp_beforeEnemyField;
      }
    }


    let enemyHandForAI  = Array.isArray(oldEnemyHand) ? oldEnemyHand.filter(Boolean) : [];
    let aiConfig = enemy.aiConfig || {
      cardPriority: [], combos: [],
      spSkipThreshold: 0.3,
      defendHpThreshold: 0.5,
      weights: { play: 1, skip: 1, defend: 1 }
    };

    // [AI][HAND] — final enemy hand snapshot before AI
    console.log('[AI][HAND]', {
      handSize: enemyHandForAI.length,
      hand: (enemyHandForAI || []).filter(Boolean).map(c => `${c?.name || 'Card'}#${c?.instanceId ?? '?'}`),
      sp: enemySp,
      hp: enemyHp
    });

    const { action: enemyAction, cards: enemyPlayableCards = [] } =
      enemyFrozenPersist
        ? { action: 'frozen', cards: [] }
        : chooseEnemyAction(enemyStats, enemySp, enemyHp, enemyStats.vitality * 100, enemyHandForAI, aiConfig);
    // Normalize AI picks to actual card objects and drop any falsy
    const _enemyPlayableCardsSAFE = (enemyPlayableCards || [])
      .map(x => (x && typeof x === 'object')
        ? x
        : oldEnemyHand.find(c => String(c.instanceId) === String(x)))
      .filter(Boolean);

    // [AI][DECIDE] — include reason context
    const handPlayableCount = enemyHandForAI.filter(c => (c?.spCost ?? 0) <= enemySp).length;
    console.log('[AI][DECIDE]', {
      enemyAction,
      picks: _enemyPlayableCardsSAFE.map(c => `${c.name}#${c.instanceId}`),
      reason: {
        sp: enemySp,
        frozen: !!enemyFrozenPersist,
        handPlayable: handPlayableCount,
        deckCount: enemyDeck.length
      }
    });

    const playedEnemyCardIds = (enemyPlayableCards || [])
      .filter(Boolean)
      .map(c => String(c.instanceId));

    if (enemyHp > 0) {
      if ((enemyAction === 'play' && enemyPlayableCards.length > 0)) {
        // NEW: log actual play
        const _enemyPlayableNames = _enemyPlayableCardsSAFE.map(c => c.name);
        console.log('[AI][PLAY]', _enemyPlayableNames);

        // enemy card-level defense
        for (const card of enemyPlayableCards) {
          if (typeof card.defense === 'number' && !isNaN(card.defense)) {
            enemyBuffDef += card.defense;
          }
        }

        // enemy PRE-DAMAGE
        const enemyTempStats  = { ...enemyStats };
        const playerTempStats = { ...playerStats };

        const ctx = {
          enemy: {
            effects: [], chanceUp: 0, chanceDown: 0,
            abilityShield: { active: false, precedence: 0, duration: 0 },
            guard: { active: false, precedence: 0, duration: 0 },
            frozenTurns: 0, curseSuppress: 0, perCard: new Map(), revive: null,
          },
          player: {
            effects: [], chanceUp: 0, chanceDown: 0,
            abilityShield: { active: false, precedence: 0, duration: 0 },
            guard: { active: false, precedence: 0, duration: 0 },
            frozenTurns: 0, curseSuppress: 0, perCard: new Map(), revive: null,
          },
        };

        // apply persistent carryover
        applyPersistentToContext({ sideKey: 'enemy',  buckets: effectBuckets, tempStats: enemyTempStats,  ctx });
        applyPersistentToContext({ sideKey: 'player', buckets: effectBuckets, tempStats: playerTempStats, ctx });

        // PRE-DMG (attack-linked deferred)
        const attackLinkedMapE = new Map();
        applyAbilityPreDamagePhase({
          attackerBase: enemyStats, defenderBase: playerStats,
          attackerTemp: enemyTempStats, defenderTemp: playerTempStats,
          attackerCards: enemyPlayableCards, defenderCards: [],
          context: ctx,
          buckets: effectBuckets,
          sourceKey: 'enemy',
          targetKey: 'player',
          attackLinkedOut: attackLinkedMapE
        });

        // INSTANT DEATH (enemy → player), with INT
        for (const card of enemyPlayableCards) {
          const per = ctx.enemy.perCard.get(String(card.instanceId));
          if (!per) continue;
          if (per.instantDeath && !ctx.player.abilityShield.active) {
            const ab = per.instantDeath;
            const base = clamp((ab.activationChance ?? 100) + ctx.enemy.chanceUp - ctx.player.chanceDown, 0, 100);
            const finalChance = intMult(base, enemyTempStats.intelligence);
            if (roll(finalChance)) playerHp = 0;
          }
        }
        if (playerHp <= 0 && effectBuckets.player.has('Revive')) {
          const eff = effectBuckets.player.get('Revive');
          const pct = clamp(eff.power, 0, 100);
          playerHp = Math.max(1, Math.floor((playerStats.vitality * 100) * (pct / 100)));
          effectBuckets.player.delete('Revive');
        }

        // Spend enemy SP
        const totalEnemySpCost = enemyPlayableCards.reduce((sum, card) => {
          const cost = (typeof card.spCost === 'number') ? card.spCost : 0;
          return sum + cost;
        }, 0);
        enemySp -= totalEnemySpCost;

        // Enemy DAMAGE (respect Guard, Durability Negation)
        let totalNetDamageToPlayer = 0;
        for (const card of enemyPlayableCards) {
          const types = getTypes(card);
          if (!types.includes('Physical') && !types.includes('Supernatural')) continue;

          const per = ctx.enemy.perCard.get(String(card.instanceId));
          let bypassGuard = per?.durabilityNegation === true;

          const attackLinkedList = attackLinkedMapE.get(String(card.instanceId)) || [];
          if (!bypassGuard && attackLinkedList.length) {
            if (attackLinkedList.some(x => x.ability.type === 'Durability Negation')) {
              bypassGuard = true;
            }
          }

          const guardActive = ctx.player.guard.active;
          if (guardActive && !bypassGuard) continue;
          if (willDodge(enemyTempStats, playerTempStats, ctx, 'enemy', 'player')) continue;

          const potency = Number(card.potency) || 0;
          const powerStat = types.includes('Physical')
            ? (Number(enemyTempStats.physicalPower) || 0)
            : (Number(enemyTempStats.supernaturalPower) || 0);

          const effAtkPow = Number(enemyTempStats.attackPower) || 0;
          const rawDamage = (potency + powerStat) * effAtkPow;

          const defenderDurability = bypassGuard ? 0 : ((Number(playerTempStats.durability) || 0) + (playerBuffDef || 0));
          const defenderPowerStat = types.includes('Physical')
            ? (Number(playerTempStats.physicalPower) || 0)
            : (Number(playerTempStats.supernaturalPower) || 0);
          const effDefensePlayer = ((defenderDurability) * defenderPowerStat) / 2;

          const netDamage = Math.max(rawDamage - effDefensePlayer, 0);
          totalNetDamageToPlayer += isNaN(netDamage) ? 0 : netDamage;
        }

        playerHp = Math.max(0, playerHp - totalNetDamageToPlayer);

        // --- Schedule enemy Multi-Hit cards onto field
        // Use normalized picks (objects), and avoid re-adding the same instanceId
        {
          const existingE = new Set((onField.enemy || []).map(fc => String(fc.instanceId)));
          for (const card of _enemyPlayableCardsSAFE) {
            const mh = (getAbilities(card) || []).find(a => a.type === 'Multi-Hit' && a.multiHit?.turns > 0);
            if (!mh) continue;
            if (onField.enemy.length >= MAX_FIELD_SLOTS) break;
            const iid = String(card.instanceId);
            if (existingE.has(iid)) continue;
            const fieldCard = makeFieldCard('enemy', card);
            if (fieldCard) {
              onField.enemy.push(fieldCard);
              onField.enemy.push(fieldCard);
              existingE.add(iid);
              console.log('[FIELD][ADD] owner=enemy card="%s" iid=%s turns=%s',
                card?.name ?? 'Card',
                fieldCard.instanceId,
                fieldCard.turnsRemaining
              );
            }
          }
        }
        // ---- Return played enemy cards to bottom of deck (non–Multi-Hit only)
        const playedEnemyCardIds = _enemyPlayableCardsSAFE.map(c => String(c.instanceId));

        // All played cards that are *not* Multi-Hit go back to the deck bottom
        const enemyNonFieldIds = new Set(
          (_enemyPlayableCardsSAFE || [])
            .filter(c => !(getAbilities(c) || []).some(a => a.type === 'Multi-Hit' && a.multiHit?.turns > 0))
            .map(c => String(c.instanceId))
        );

        // Take those from enemy hand, append to bottom of deck
        const toDeckE = (oldEnemyHand || []).filter(c =>
          playedEnemyCardIds.includes(String(c.instanceId)) &&
          enemyNonFieldIds.has(String(c.instanceId))
        );

        enemyDeck = [...(enemyDeck || []), ...toDeckE];

        // Remove the just-played cards (both the fielded and the ones returned to deck) from hand
        oldEnemyHand = (oldEnemyHand || []).filter(c => !playedEnemyCardIds.includes(String(c.instanceId)));

        // Draw back up to HAND_SIZE
        const enemyDrawRes = drawUpToHand(oldEnemyHand, enemyDeck, enemyDiscard, [], HAND_SIZE);
        oldEnemyHand = enemyDrawRes.newHand;
        enemyDeck    = enemyDrawRes.newDeck;
        enemyDiscard = enemyDrawRes.newDiscard;

        // Debug piles after enemy action
        console.log('[EPILE][AFTER]', {
          eHand: oldEnemyHand.length,
          eDeck: enemyDeck.length,
          eDiscard: enemyDiscard.length
        });

      } else if (enemyAction === 'frozen') {
        console.log('[FREEZE][GATE]', { owner: 'enemy', blockedAction: enemyAction });
        console.log('[FREEZE][AUTOSKIP]', { owner: 'enemy' });
        // Enemy frozen: cannot act; rotate hand but no SP recovery
        enemyDeck = [...enemyDeck, ...oldEnemyHand];
        oldEnemyHand = [];
        enemyDiscard = [];
        let enemyDrawRes = drawUpToHand(oldEnemyHand, enemyDeck, enemyDiscard, [], HAND_SIZE);
        oldEnemyHand = enemyDrawRes.newHand;
        enemyDeck    = enemyDrawRes.newDeck;
        enemyDiscard = enemyDrawRes.newDiscard;

      } else if (enemyAction === 'skip' || enemyAction === 'defend') {
        if (enemyAction === 'skip') {
          enemySp = Math.min(enemyStats.maxSp, enemySp + 2);
          enemyBuffs.push('Skip');
        } else {
          enemySp = Math.min(enemyStats.maxSp, enemySp + 1);
          enemyBuffs.push('Defend');
        }
        enemyDeck = [...enemyDeck, ...oldEnemyHand];
        oldEnemyHand = [];
        enemyDiscard = [];
        let enemyDrawRes = drawUpToHand(oldEnemyHand, enemyDeck, enemyDiscard, [], HAND_SIZE);
        oldEnemyHand = enemyDrawRes.newHand;
        enemyDeck    = enemyDrawRes.newDeck;
        enemyDiscard = enemyDrawRes.newDiscard;
      }
    }

    // Clamp vital stats
    playerHp = Math.max(0, playerHp);
    playerSp = Math.max(0, playerSp);
    enemyHp  = Math.max(0, enemyHp);
    enemySp  = Math.max(0, enemySp);

    // === Duration tick (end of round) with snapshots ===
    {
      const snap = (map) => Array.from(map.entries()).map(([k,e]) => `${k}[${e.remaining}]`).join(', ');
      console.log('[PERSIST][BEFORE_TICK]', {
        player: snap(effectBuckets.player),
        enemy:  snap(effectBuckets.enemy),
      });
    }

    const tickBuckets = (map, who) => {
      for (const eff of map.values()) {
        const before = eff.remaining;
        if (eff.remaining > 0) eff.remaining -= 1;
        console.log(`[DUR][TICK] ${who} ${eff.type}${eff.target?`(${eff.target})`:''} ${before} -> ${eff.remaining}`);
        if (eff.remaining <= 0) {
          console.log(`[DUR][EXPIRE] ${who} ${eff.type}${eff.target?`(${eff.target})`:''}`);
          map.delete(eff.type + (eff.target ? `:${eff.target}` : ''));
        }
      }
    };
    tickBuckets(effectBuckets.player, 'player');
    tickBuckets(effectBuckets.enemy,  'enemy');

    {
      const snap = (map) => Array.from(map.entries()).map(([k,e]) => `${k}[${e.remaining}]`).join(', ');
      console.log('[PERSIST][AFTER_TICK]', {
        player: snap(effectBuckets.player),
        enemy:  snap(effectBuckets.enemy),
      });
    }

    // End-of-round summary logs
    const summarize = (map) => Array.from(map.values()).map(e => `${e.type}${e.target?`(${e.target})`:''} x${e.power} [${e.remaining}]`).join(', ');
    console.log(`[ROUND][EFFECTS] player: ${summarize(effectBuckets.player) || '-'} | enemy: ${summarize(effectBuckets.enemy) || '-'}`);
    console.log(`[ROUND][FIELD] player=${(onField.player||[]).map(f=>`${f.card.name}(${f.turnsRemaining})`).join(',') || '-'} | enemy=${(onField.enemy||[]).map(f=>`${f.card.name}(${f.turnsRemaining})`).join(',') || '-'}`);

    // Build effective stats (for UI display)
    const playerEff = { ...playerStats };
    const enemyEff  = { ...enemyStats };
    const ctx0 = {
      player: { chanceUp:0, chanceDown:0, abilityShield:{active:false,precedence:0,duration:0}, guard:{active:false,precedence:0,duration:0}, frozenTurns:0, curseSuppress:0, perCard:new Map(), revive:null },
      enemy:  { chanceUp:0, chanceDown:0, abilityShield:{active:false,precedence:0,duration:0}, guard:{active:false,precedence:0,duration:0}, frozenTurns:0, curseSuppress:0, perCard:new Map(), revive:null },
    };
    applyPersistentToContext({ sideKey:'player', buckets: effectBuckets, tempStats: playerEff, ctx: ctx0 });
    applyPersistentToContext({ sideKey:'enemy',  buckets: effectBuckets, tempStats: enemyEff,  ctx: ctx0 });

    const respActive = dumpActiveBuckets(effectBuckets);

    // Extra guard-log (requested)
    console.log('[RESP][PILE]', {
      hand: oldPlayerHand.length,
      deck: playerDeck.length,
      discard: playerDiscard.length
    });

    // [RESP][PILES] — sizes for FE reconciliation
    console.log('[RESP][PILES]', {
      pHand: oldPlayerHand.length,
      pDeck: playerDeck.length,
      pDiscard: playerDiscard.length,
      eHand: oldEnemyHand.length,
      eDeck: enemyDeck.length,
      eDiscard: enemyDiscard.length
    });

    // === RESPONSE (base stats persisted; effective sent separately) ===
    // DEBUG: Log all stats sent to FE (normal)
    try {
      console.log('[RESP][STATS]', {
        ctx: 'normal',
        // Base stats after campaign initial + extraStats deltas
        playerBase: {
          attackPower:       playerStats.attackPower,
          physicalPower:     playerStats.physicalPower,
          supernaturalPower: playerStats.supernaturalPower,
          durability:        playerStats.durability,
          vitality:          playerStats.vitality,
          intelligence:      playerStats.intelligence,
          speed:             playerStats.speed,
          sp:                playerStats.sp,
          maxSp:             playerStats.maxSp,
        },
        enemyBase: {
          attackPower:       enemyStats.attackPower,
          physicalPower:     enemyStats.physicalPower,
          supernaturalPower: enemyStats.supernaturalPower,
          durability:        enemyStats.durability,
          vitality:          enemyStats.vitality,
          intelligence:      enemyStats.intelligence,
          speed:             enemyStats.speed,
          sp:                enemyStats.sp,
          maxSp:             enemyStats.maxSp,
        },
        // Derived for the response
        hp: { playerHp, enemyHp },
        sp: { playerSp, enemySp },
        // “Effective” (after persistent buffs) for comparison
        effective: {
          player: {
            attackPower:       playerEff.attackPower,
            physicalPower:     playerEff.physicalPower,
            supernaturalPower: playerEff.supernaturalPower,
          },
          enemy: {
            attackPower:       enemyEff.attackPower,
            physicalPower:     enemyEff.physicalPower,
            supernaturalPower: enemyEff.supernaturalPower,
          }
        }
      });
    } catch {}

    return res.json({
      result: {
        // Base, persisted state (what FE should keep across turns)
        player: {
          hpRemaining: playerHp,
          sp:          playerSp,
          maxSp:       playerStats.maxSp,
          // send base, not buffed:
          attackPower:       playerStats.attackPower,
          physicalPower:     playerStats.physicalPower,
          supernaturalPower: playerStats.supernaturalPower,
          defense:           playerBuffDef,
          speed:             playerStats.speed,
          buffs:       [],
          message,
          hand:        oldPlayerHand,
          deck:        playerDeck,
          discard:     playerDiscard,
        },
        enemy: {
          hpRemaining: enemyHp,
          sp:          enemySp,
          maxSp:       enemyStats.maxSp,
          vitality:        enemyStats.vitality,
          attackPower:       enemyStats.attackPower,
          physicalPower:     enemyStats.physicalPower,
          supernaturalPower: enemyStats.supernaturalPower,
          defense:           enemyBuffDef,
          speed:             enemyStats.speed,
          buffs:       [],
          hand:        oldEnemyHand,
          deck:        enemyDeck,
          discard:     enemyDiscard,
        },

        // Extra: effective (buffed) stats for UI display/testing only
        effectiveStats: {
          player: {
            attackPower:       playerEff.attackPower,
            physicalPower:     playerEff.physicalPower,
            supernaturalPower: playerEff.supernaturalPower,
          },
          enemy: {
            attackPower:       enemyEff.attackPower,
            physicalPower:     enemyEff.physicalPower,
            supernaturalPower: enemyEff.supernaturalPower,
          }
        },

        // persistent effects (send back to next request)
        activeEffects: respActive,
        // on-field (send back; client must echo under req.body.onField next turn)
        onField,
        // UI can present choices; send back as retargetChoices next turn
        retargetPrompts,
        defendUsed,
      },
    });

  } catch (err) {
    console.error('[GAME_CONTROLLER][PLAY_TURN]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
const patchState = async (req, res) => {
  try {
    const userId = req.user._id;
    const patch = req.body || {};

    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: 'No game data provided' });
    }

    // Build atomic update
    const update = {};
    // If caller wants to clear checkpoint, accept null/undefined as a signal to $unset
    if ('checkpoint' in patch && (patch.checkpoint === null || patch.checkpoint === undefined)) {
      update.$unset = { checkpoint: '' };
      // do not also $set checkpoint=null
      const { checkpoint, ...rest } = patch;
      if (Object.keys(rest).length) update.$set = rest;
    } else {
      update.$set = patch;
    }

    const saved = await SavedGame.findOneAndUpdate(
      { user: userId },
      update,
      { new: true, upsert: true }
    );

    return res.json({ message: 'Game state patched', savedGame: saved });
  } catch (err) {
    console.error('[GAME_CONTROLLER][PATCH_STATE]', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
module.exports = {
  saveState,
  patchState,
  loadState,
  playTurn,
  clearState,
};