// controllers/roomController.js

// Models
const mongoose = require('mongoose');
const Room = require('../models/Room');
const Enemy = require('../models/Enemy');
// SavedGame is optional at boot so the app can run without it;
// the merchant purchase handler will 501 if it's missing.
let SavedGame;
try { SavedGame = require('../models/SavedGame'); } catch {}
// --- validation helpers ---
const WORD_LIMIT = 30; // Merchant dialogue word cap
const wordCount = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const MAX_AUDIO_KB = 3500;      // ~3.4 MB
const MAX_AUDIO_SEC = 180;      // 3 minutes

function validateRoomPayload(body) {
  // backgrounds length ≤ 5; allow URLs and PNG/JPEG. For data-URIs, enforce ≤ 90KB.
  if (Array.isArray(body.backgrounds)) {
    if (body.backgrounds.length > 5) throw new Error('Max 5 backgrounds');
    for (const img of body.backgrounds) {
      const data = img?.data || '';
      const isUrl = typeof data === 'string' && /^https?:\/\//i.test(data);

      // For data: payloads (non-URL), enforce size + mime limits to keep memory sane
      if (!isUrl) {
        if ((img?.sizeKB ?? 0) > 90) throw new Error('Background image too large (> 90KB)');
        if (img?.mime && !(img.mime === 'image/jpeg' || img.mime === 'image/png')) {
          throw new Error('Background image must be image/jpeg or image/png');
        }
      } else {
        // For URLs, allow http(s). If mime is supplied, keep to jpeg/png.
        if (img?.mime && !(img.mime === 'image/jpeg' || img.mime === 'image/png')) {
          throw new Error('Background image must be image/jpeg or image/png');
        }
      }
    }
  }

  // NEW: roomAudio (single mp3)
  if (body.roomAudio) {
    const a = body.roomAudio || {};
    if (a.mime !== 'audio/mpeg') throw new Error('Room audio must be MP3 (audio/mpeg)');
    if (!Number.isFinite(a.sizeKB) || a.sizeKB > MAX_AUDIO_KB) throw new Error(`Room audio too large (> ${MAX_AUDIO_KB}KB)`);
    if (a.durationSec != null) {
      const d = Number(a.durationSec);
      if (!Number.isFinite(d) || d < 1 || d > MAX_AUDIO_SEC) throw new Error('Room audio duration must be ≤ 180 seconds');
    }
  }

  // Merchant dialogue word count ≤ 30 on each field
  const dlg = body?.merchant?.dialogue;
  if (dlg) {
    for (const f of ['onEnter', 'onBuy', 'onExit']) {
      if (dlg[f] && wordCount(dlg[f]) > WORD_LIMIT) {
        throw new Error(`merchant.dialogue.${f} exceeds ${WORD_LIMIT} words`);
      }
    }
  }
}

// --- CRUD ---
exports.createRoom = async (req, res) => {
  try {
    validateRoomPayload(req.body);
    // Force owner from auth when available
    const doc = new Room({ ...req.body, owner: req.user?._id || req.body.owner });
    await doc.save();
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: 'Failed to create room', error: e.message });
  }
};

exports.updateRoom = async (req, res) => {
  try {
    validateRoomPayload(req.body);
    const id = req.params.id;
    const current = await Room.findById(id);
    if (!current) return res.status(404).json({ message: 'Not found' });
    if (current.owner && req.user && String(current.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: not the owner' });
    }
    const updated = await Room.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: 'Failed to update room', error: e.message });
  }
};

exports.getRoomById = async (req, res) => {
  try {
    const doc = await Room.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    // Enrich enemy data for nicer UI labels
    let enemySummaries = [];
    const ids = Array.isArray(doc.enemyIds) ? doc.enemyIds.map(String) : [];
    if (ids.length) {
      const rows = await Enemy.find({ _id: { $in: ids } }, 'name imageUrl').lean();
      const byId = new Map(rows.map(r => [String(r._id), r]));
      enemySummaries = ids.map(id => {
        const e = byId.get(id);
        return e ? { _id: id, name: e.name, imageUrl: e.imageUrl } : { _id: id, name: id };
      });
    }
    const out = doc.toObject ? doc.toObject() : doc;
    out.enemySummaries = enemySummaries;
    out.enemies = enemySummaries; // alias for frontends using `enemies`
    if (Array.isArray(out.enemyIds) && out.enemyIds.length) {
      out.enemyId = String(out.enemyIds[0]);
    } else if (enemySummaries.length) {
      out.enemyId = String(enemySummaries[0]._id || enemySummaries[0].id || '');
    } else {
      out.enemyId = null;
    }
    if (Array.isArray(out.enemyIds) && out.enemyIds.length) {
      out.enemyId = String(out.enemyIds[0]);
    } else if (enemySummaries.length) {
      out.enemyId = String(enemySummaries[0]._id || enemySummaries[0].id || '');
    } else {
      out.enemyId = null;
    }
    res.json(out);
  } catch (e) {
    res.status(400).json({ message: 'Bad id', error: e.message });
  }
};

// Alias for routes using a shorter name
exports.getRoom = (...args) => exports.getRoomById(...args);

exports.listRooms = async (req, res) => {
  const scope = String(req.query.scope || 'mine').toLowerCase();
  const filter = (req.user && scope !== 'all') ? { owner: req.user._id } : {};
  const items = await Room.find(filter).sort({ createdAt: -1 });
  res.json(items);
};

exports.deleteRoom = async (req, res) => {
  const id = req.params.id;
  const doc = await Room.findById(id);
  if (!doc) return res.status(404).json({ message: 'Not found' });
  if (doc.owner && req.user && String(doc.owner) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden: not the owner' });
  }
  await Room.findByIdAndDelete(id);
  res.json({ ok: true });
};

// --- Action helpers (schema-driven) ---

// GET /api/rooms/:id/merchant → return authored shop (no mocks)
exports.getMerchantItems = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.type !== 'merchant') return res.status(400).json({ message: 'Not a merchant room' });

    res.json({
      items: room.merchant?.items || [],
      merchantImg: room.merchant?.merchantImg,
      frameImg: room.merchant?.frameImg,
      dialogue: room.merchant?.dialogue
    });
  } catch (e) {
    res.status(400).json({ message: 'Failed to fetch merchant', error: e.message });
  }
};

// For routes expecting different names
exports.getMerchantForRoom = (...args) => exports.getMerchantItems(...args);

// POST /api/rooms/:id/merchant/buy → { itemIndex } deducts money and returns reward
// POST /api/rooms/:id/merchant/buy → { itemIndex } deducts money and returns reward
exports.buyFromMerchant = async (req, res) => {
  try {
    if (!SavedGame) {
      return res.status(501).json({ message: 'SavedGame model missing. Add models/SavedGame.js and wire auth/game id.' });
    }

    const rawIndex = req.body && req.body.itemIndex;
    const itemIndex = Number(rawIndex);
    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid itemIndex' });
    }

    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.type !== 'merchant') return res.status(400).json({ message: 'Not a merchant room' });

    const item = room.merchant?.items?.[itemIndex];
    if (!item) return res.status(404).json({ message: 'Item not found' });

    // Resolve SavedGame by gameId OR fallback to current user
    const gameId =
      req.query.gameId ||
      req.query.game ||
      req.body.gameId ||
      req.body.game ||
      req.headers['x-game-id'] ||
      req.user?.gameId ||
      req.user?.currentGameId;

    let game = null;
    if (gameId && req.user?._id) {
      game = await SavedGame.findOne({ _id: gameId, user: req.user._id });
    }
    if (!game && req.user?._id) {
      game = await SavedGame.findOne({ user: req.user._id });
    }
    if (!game) return res.status(404).json({ message: 'SavedGame not found' });

    const price = Math.max(0, item.price || 0);

    // Atomic, race-safe deduction (fails if not enough money)
    const updated = await SavedGame.findOneAndUpdate(
      { _id: game._id, user: req.user._id, money: { $gte: price } },
      { $inc: { money: -price } },
      { new: true }
    );
    if (!updated) {
      return res.status(400).json({ message: 'Not enough money' });
    }

    // Return new balance and the item (FE applies the reward to deck/stats)
    res.json({ ok: true, money: updated.money, reward: item });
  } catch (e) {
    res.status(400).json({ message: 'Purchase failed', error: e.message });
  }
};

// Alias for routes using different name
exports.buyMerchantItem = (...args) => exports.buyFromMerchant(...args);

// GET /api/rooms/:id/loot → authored loot
exports.getLootForRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.type !== 'loot') return res.status(400).json({ message: 'Not a loot room' });

    // DEBUG LOG
    try {
      console.log('[ROOM][LOOT]', {
        roomId: req.params.id,
        user: req.user?._id ? String(req.user._id) : null,
        lootCount: Array.isArray(room.loot) ? room.loot.length : 0
      });
    } catch {}

    res.json({ loot: Array.isArray(room.loot) ? room.loot : [], backgrounds: room.backgrounds || [] });
  } catch (e) {
    res.status(400).json({ message: 'Failed to fetch loot', error: e.message });
  }
};

// GET /api/rooms/:id/event → authored event
exports.getEventForRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.type !== 'event') return res.status(400).json({ message: 'Not an event room' });

    const raw = room.event || {};

    // meet-join has been removed
    if (raw.kind === 'meet-join') {
      return res.status(410).json({ message: 'Event kind "meet-join" has been removed' });
    }

    // Pass-through (no character/actor enrichment)
    return res.json({
      event: raw,
      backgrounds: room.backgrounds || [],
    });
  } catch (e) {
    console.warn('[ROOM][EVENT][ERR]', e);
    res.status(400).json({ message: 'Failed to fetch event', error: e.message });
  }
};

// ---- Deprecated endpoints (no :id) ----
exports.getMerchantItemsLegacy = (_req, res) =>
  res.status(410).json({ message: 'Deprecated. Use /api/rooms/:id/merchant' });

exports.getLoot = (_req, res) =>
  res.status(410).json({ message: 'Deprecated. Use /api/rooms/:id/loot' });

exports.getEvent = (_req, res) =>
  res.status(410).json({ message: 'Deprecated. Use /api/rooms/:id/event' });
