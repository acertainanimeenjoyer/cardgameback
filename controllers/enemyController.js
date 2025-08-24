// controllers/enemyController.js

const Enemy    = require('../models/Enemy');
const mongoose = require('mongoose');

// --- Helper: Patch stats and attach deck ---
function patchEnemyDoc(enemyDoc) {
  if (!enemyDoc) return null;

  // 1) Normalize stats
  const defaults = {
    hp:               100,
    sp:                3,
    maxSp:             5,
    attackPower:      10,
    supernaturalPower:10,
    physicalPower:    10,
    durability:       10,
    vitality:          1,
    intelligence:      1,
    speed:             5,
    defense:          10,
  };

  const raw = enemyDoc.toObject();
  // Compute base HP by vitality if no positive hp
  const baseHp =
    typeof raw.stats.vitality === 'number' && raw.stats.vitality > 0
      ? raw.stats.vitality * 100
      : defaults.hp;
  const hp =
    typeof raw.stats.hp === 'number' && raw.stats.hp > 0
      ? raw.stats.hp
      : baseHp;

  // Merge defaults + stored stats, override hp last
  const patchedStats = {
    ...defaults,
    ...raw.stats,
    hp,
  };

  // 2) Build our final returned enemy
  return {
    ...raw,
    stats: patchedStats,
    // Expose deck (cards) to frontend—instead of raw.moveSet
    deck: Array.isArray(raw.moveSet) ? raw.moveSet : [],
  };
}

// Create new enemy
exports.createEnemy = async (req, res) => {
  try {
    console.log('[ENEMY][CREATE] Payload:', req.body);
    let enemy = new Enemy({ ...req.body, owner: req.user?._id || req.body.owner });
    await enemy.save();
    // Re-fetch with populated moveSet
    enemy = await Enemy.findById(enemy._id).populate('moveSet');
    const result = patchEnemyDoc(enemy);
    console.log('[ENEMY][CREATE] Created:', result);
    res.status(201).json(result);
  } catch (err) {
    console.error('[ENEMY][CREATE] Error:', err);
    res.status(400).json({ message: 'Enemy creation failed', error: err.message });
  }
};

// Get all enemies
exports.getEnemies = async (req, res) => {
  try {
    console.log('[ENEMY][GET_ALL]');
    const scope = String(req.query.scope || 'mine').toLowerCase();
    const filter = (req.user && scope !== 'all') ? { owner: req.user._id } : {};
    const enemies = await Enemy.find(filter).populate('moveSet');
    const result = enemies.map(patchEnemyDoc);
    console.log(`[ENEMY][GET_ALL] Found ${result.length} enemies`);
    res.json(result);
  } catch (err) {
    console.error('[ENEMY][GET_ALL] Error:', err);
    res.status(500).json({ message: 'Failed to fetch enemies' });
  }
};

// Get enemy by ID
exports.getEnemyById = async (req, res) => {
  const { id } = req.params;
  console.log('[ENEMY][GET_BY_ID]', id);
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.warn('[ENEMY][GET_BY_ID] Invalid ID:', id);
      return res.status(400).json({ message: 'Invalid enemy ID' });
    }
    const enemy = await Enemy.findById(id).populate('moveSet');
    if (!enemy) {
      console.warn('[ENEMY][GET_BY_ID] Not found:', id);
      return res.status(404).json({ message: 'Enemy not found' });
    }
    const result = patchEnemyDoc(enemy);
    console.log('[ENEMY][GET_BY_ID] Returning:', result);
    res.json(result);
  } catch (err) {
    console.error('[ENEMY][GET_BY_ID] Error:', err);
    res.status(500).json({ message: 'Failed to fetch enemy' });
  }
};

// Update enemy
exports.updateEnemy = async (req, res) => {
  const { id } = req.params;
  console.log('[ENEMY][UPDATE]', id, req.body);
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.warn('[ENEMY][UPDATE] Invalid ID:', id);
      return res.status(400).json({ message: 'Invalid enemy ID' });
    }

    const current = await Enemy.findById(id);
    if (!current) {
      console.warn('[ENEMY][UPDATE] Not found:', id);
      return res.status(404).json({ message: 'Enemy not found' });
    }
    if (current.owner && req.user && String(current.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: not the owner' });
    }

    let enemy = await Enemy.findByIdAndUpdate(id, req.body, { new: true });
    enemy = await Enemy.findById(id).populate('moveSet');
    const result = patchEnemyDoc(enemy);
    console.log('[ENEMY][UPDATE] Updated:', result);
    res.json(result);
  } catch (err) {
    console.error('[ENEMY][UPDATE] Error:', err);
    res.status(400).json({ message: 'Failed to update enemy', error: err.message });
  }
};

// Delete enemy
exports.deleteEnemy = async (req, res) => {
  const { id } = req.params;
  console.log('[ENEMY][DELETE]', id);
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.warn('[ENEMY][DELETE] Invalid ID:', id);
      return res.status(400).json({ message: 'Invalid enemy ID' });
    }

    const current = await Enemy.findById(id);
    if (!current) {
      console.warn('[ENEMY][DELETE] Not found:', id);
      return res.status(404).json({ message: 'Enemy not found' });
    }
    if (current.owner && req.user && String(current.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: not the owner' });
    }

    const enemy = await Enemy.findByIdAndDelete(id);
    console.log('[ENEMY][DELETE] Deleted:', id);
    res.json({ message: 'Enemy deleted' });
  } catch (err) {
    console.error('[ENEMY][DELETE] Error:', err);
    res.status(400).json({ message: 'Failed to delete enemy', error: err.message });
  }
};

// BULK: create multiple enemies at once
exports.createEnemiesBulk = async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : (req.body.enemies || []);
    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({ message: 'Provide an array of enemies (or { enemies: [...] }).' });
    }

    // attach owner to each payload and insert (lets Mongoose validate/cast moveSet ObjectIds)
    const ownedPayload = payload.map(p => ({ ...p, owner: req.user?._id || p.owner }));
    const inserted = await Enemy.insertMany(ownedPayload, { ordered: true });

    // Re-fetch populated to keep response uniform with single create
    const ids = inserted.map(e => e._id);
    const created = await Enemy.find({ _id: { $in: ids } }).populate('moveSet');
    // Keep original order
    const map = new Map(created.map(doc => [String(doc._id), doc]));
    const result = inserted.map(x => patchEnemyDoc(map.get(String(x._id))));

    res.status(201).json(result);
  } catch (err) {
    console.error('[ENEMY_CONTROLLER][CREATE_BULK]', err);
    res.status(400).json({ message: 'Bulk enemy creation failed', error: String(err.message || err) });
  }
};