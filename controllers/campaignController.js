// controllers/campaignController.js
const mongoose = require('mongoose');
const Enemy = require('../models/Enemy');
const Campaign = require('../models/Campaign');
const Room = require('../models/Room');
const SavedGame = require('../models/SavedGame');
const User = require('../models/User');

// ---- Popularity (playing now) with in-memory heartbeats ----
const HEARTBEAT_TTL_MS = 90 * 1000; // consider "online" if pinged within last 90s
// Map<campaignId, Map<userId, lastTs>>
const activeRuns = new Map();
function now() { return Date.now(); }
function touch(campaignId, userId) {
  const id = String(campaignId);
  const uid = String(userId);
  let map = activeRuns.get(id);
  if (!map) { map = new Map(); activeRuns.set(id, map); }
  map.set(uid, now());
}
function countPlaying(id) {
  const map = activeRuns.get(String(id));
  if (!map) return 0;
  const cutoff = now() - HEARTBEAT_TTL_MS;
  for (const [uid, ts] of map.entries()) {
    if (ts < cutoff) map.delete(uid);
  }
  return map.size;
}

// POST /api/campaigns/:id/heartbeat
const heartbeat = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.user?._id) return res.status(401).json({ message: 'Authentication required' });
    const exists = await Campaign.exists({ _id: id });
    if (!exists) return res.status(404).json({ message: 'Campaign not found' });
    touch(id, req.user._id);
    return res.json({ playingNow: countPlaying(id) });
  } catch (e) {
    return res.status(500).json({ message: 'Heartbeat error' });
  }
};

// POST /api/campaigns/:id/like  (toggle like/unlike for this user via EMAIL)
const likeCampaign = async (req, res) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: 'Authentication required' });
    const { id } = req.params;

    // Resolve current user's email (anchor)
    const u = await User.findById(req.user._id, 'email').lean();
    const email = (u?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ message: 'Email not found' });

    // Read current like state
    const cur = await Campaign.findById(id, 'likes likedBy likedByEmails').lean();
    if (!cur) return res.status(404).json({ message: 'Not found' });

    // Support both legacy likedBy (ObjectIds) and new likedByEmails (strings)
    const likedByEmails = Array.isArray(cur.likedByEmails) ? cur.likedByEmails : [];
    const hasLiked = likedByEmails.includes(email);

    // Toggle atomically (no dupes thanks to $addToSet)
    const update = hasLiked
      ? { $pull: { likedByEmails: email }, $inc: { likes: -1 } }
      : { $addToSet: { likedByEmails: email }, $inc: { likes: 1 } };

    const doc = await Campaign.findByIdAndUpdate(id, update, { new: true, projection: 'likes likedByEmails' });
    if (!doc) return res.status(404).json({ message: 'Not found' });

    const likes = Math.max(0, Number(doc.likes || 0));
    return res.json({ liked: !hasLiked, likes });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to like' });
  }
};


// --- Fallback generator
const getDefaultCampaign = async (req, res) => {
  const length = parseInt(req.params.length, 10) || 10;
  const roomTypes = [
    { type: 'combat',   weight: 4 },
    { type: 'loot',     weight: 2 },
    { type: 'merchant', weight: 1 },
    { type: 'event',    weight: 2 },
  ];

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n|0));
  const q = req.query || {};

  function pickRoomType() {
    const totalWeight = roomTypes.reduce((sum, t) => sum + t.weight, 0);
    let rnd = Math.random() * totalWeight;
    for (let i = 0; i < roomTypes.length; i++) {
      if (rnd < roomTypes[i].weight) return roomTypes[i].type;
      rnd -= roomTypes[i].weight;
    }
    return roomTypes[0].type;
  }

  let enemyIds = [];
  try {
    const allEnemies = await Enemy.find({}, '_id');
    enemyIds = allEnemies.map(e => e._id.toString());
    if (enemyIds.length === 0) return res.status(500).json({ message: 'No enemies in DB!' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch enemies', error: err.message });
  }

  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  const rooms = [];
  for (let i = 0; i < length; i++) {
    const type = (i === length - 1) ? 'boss' : pickRoomType();
    const room = { index: i, type };

    if (type === 'combat' || type === 'boss') {
      room.enemyId = enemyIds[Math.floor(Math.random() * enemyIds.length)];
    }
    if (type === 'loot') {
      room.lootTable = ['gold', 'potion', 'card'];
    }
    if (type === 'merchant') {
      room.shopItems = ['card', 'upgrade', 'heal'];
    }

    rooms.push(room);
  }

  res.json(rooms);
};

// ----- Campaign CRUD -----
const createCampaign = async (req, res) => {
  try {
    const body = { ...req.body, owner: req.user?._id || req.body.owner };
    // accept thumbnail alias on input
    if (body.thumbnail && !body.cover) body.cover = body.thumbnail;
    const doc = new Campaign(body);
    await doc.save();
    // always include thumbnail alias on output
    const out = doc.toObject();
    out.thumbnail = out.cover ?? null;
    res.status(201).json(out);
  } catch (e) {
    res.status(400).json({ message: 'Failed to create campaign', error: e.message });
  }
};

const updateCampaign = async (req, res) => {
  try {
    const id = req.params.id;
    const current = await Campaign.findById(id);
    if (!current) return res.status(404).json({ message: 'Not found' });
    if (current.owner && req.user && String(current.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: not the owner' });
    }
    const body = { ...req.body };
    // accept thumbnail alias on input
    if (body.thumbnail && !body.cover) body.cover = body.thumbnail;
    const updated = await Campaign.findByIdAndUpdate(id, body, { new: true, runValidators: true });
    const out = updated ? updated.toObject() : null;
    if (!out) return res.status(404).json({ message: 'Not found after update' });
    out.thumbnail = out.cover ?? null; // include alias on output
    res.json(out);
  } catch (e) {
    res.status(400).json({ message: 'Failed to update', error: e.message });
  }
};

const getCampaignById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Campaign.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    // include thumbnail alias for clients that still read `thumbnail`
    res.json({ ...doc, thumbnail: doc.cover ?? null, playingNow: countPlaying(id) });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
};

const listCampaigns = async (req, res) => {
  try {
    const scope = String(req.query.scope || 'mine');
    let query = {};
    if (scope !== 'all') {
      if (!req.user || !req.user._id) {
        return res.json([]); // not logged in + mine → empty list
      }
      query = { owner: req.user._id };
    }
    const items = await Campaign.find(query).sort({ createdAt: -1 }).lean();
    const withMeta = items.map(c => ({
      ...c,
      thumbnail: c.cover ?? null,            // provide alias
      playingNow: countPlaying(c._id)
    }));
    res.json(withMeta);
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteCampaign = async (req, res) => {
  const id = req.params.id;
  const doc = await Campaign.findById(id);
  if (!doc) return res.status(404).json({ message: 'Not found' });
  if (doc.owner && req.user && String(doc.owner) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden: not the owner' });
  }
  await Campaign.findByIdAndDelete(id);
  res.json({ ok: true });
};


// ----- Helpers for generation -----
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n|0));
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const pickRandomLoot = (campaign) => {
  const rl = campaign?.generator?.randomLoot;
  const items = Array.isArray(rl?.items) ? rl.items.slice() : [];
  const maxPicks = clamp(rl?.maxPicks ?? 1, 1, 3);
  if (!items.length) return [];
  const picks = 1 + Math.floor(Math.random() * maxPicks);
  return shuffle(items).slice(0, picks);
};
const pickEnemyId = async () => {
  const pool = await Enemy.find({}, '_id').lean();
  if (!pool.length) throw new Error('No enemies in DB');
  const i = Math.floor(Math.random() * pool.length);
  return String(pool[i]._id);
};

const pickRoomTypeWeighted = (weights) => {
  const total = weights.reduce((s, w) => s + (w.weight || 0), 0);
  let r = Math.random() * (total || 1);
  for (const w of weights) {
    r -= (w.weight || 0);
    if (r <= 0) return w.type;
  }
  return weights[0]?.type || 'combat';
};

// POST /api/campaigns/:id/start
// Creates/updates the user's SavedGame with a frozen room sequence and resets progress.
const startRun = async (req, res) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: 'Authentication required' });
    const { id } = req.params;
    const campaign = await Campaign.findById(id).lean();
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    // Materialize a canonical room sequence (reuse helpers in this file)
    let sequence = [];

    if (Array.isArray(campaign.roomSequence) && campaign.roomSequence.length) {
      // Use authored roomSequence as-is (normalize to minimal room shape)
      sequence = await (async () => {
        const raw = campaign.roomSequence;
        const ids = raw
          .map(r => (typeof r === 'string' || (r && typeof r === 'object' && r._id)) ? (r._id || r) : null)
          .filter(Boolean)
          .map(String);

        let out = [];
        if (ids.length) {
          const docs = await Room.find({ _id: { $in: ids } }).lean();
          const map = new Map(docs.map(d => [String(d._id), d]));
          out = raw.map((r, i) => {
            if (typeof r === 'string') return pickRoomFields(map.get(String(r)), i);
            if (r && typeof r === 'object' && r._id) return pickRoomFields(map.get(String(r._id)) || r, i);
            if (r && typeof r === 'object' && r.type) return pickRoomFields(r, i);
            return pickRoomFields(null, i);
          });
        } else {
          out = raw.map((r, i) => pickRoomFields(r, i));
        }
        return out;
      })();
    } else {
      // Generate a sequence using the same policy as /generate
      const len = clamp(campaign.length ?? 6, 1, 100);
      const w = campaign?.generator?.roomWeights ?? [
        { type: 'combat', weight: 4 },
        { type: 'loot',   weight: 2 },
        { type: 'merchant', weight: 1 },
        { type: 'event',  weight: 2 }
      ];

      for (let i = 0; i < len; i++) {
        const isLast = i === len - 1;
        const type = isLast ? 'boss' : pickRoomTypeWeighted(w);
        const room = { index: i, type };
        if (type === 'combat' || type === 'boss') {
          room.enemyId = await pickEnemyId();
        } else if (type === 'loot') {
          room.loot = pickRandomLoot(campaign);
        } else if (type === 'merchant') {
          // keep empty items if none authored; FE will render an empty shop
          room.merchant = { items: [] };
        }
        sequence.push(pickRoomFields(room, i));
      }
    }

    // Persist to SavedGame (freeze path + reset progress; no roster/team/decks)
    const startingMoney =
      Number.isFinite(campaign?.playerSetup?.startingMoney) ? Number(campaign.playerSetup.startingMoney) : 0;

    const doc = await SavedGame.findOneAndUpdate(
      { user: req.user._id },
      {
        $set: {
          campaign: sequence,             // legacy/simple path for current FE
          roomIndex: 0,
          money: startingMoney,
          progress: {
            campaignId: campaign._id,
            roomIndex: 0,
            generatedPath: sequence
          }
        }
      },
      { new: true, upsert: true }
    );

    return res.json({
      ok: true,
      savedGameId: String(doc._id),
      progress: doc.progress,
      roomIndex: doc.roomIndex,
      money: doc.money,
      sequence
    });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to start run', error: String(e.message || e) });
  }
};

// --- Normalize a Room doc/object to the minimal shape the client needs ---
const pickRoomFields = (r, index) => {
  if (!r) return { index, type: 'unknown' };
  const base = {
    index,
    _id: String(r._id || r.id || ''),
    type: r.type,
    backgrounds: r.backgrounds || [],
  };

  if (r.type === 'combat' || r.type === 'boss') {
    const enemyId = r.enemyId
      ? String(r.enemyId)
      : ((Array.isArray(r.enemyIds) && r.enemyIds.length) ? String(r.enemyIds[0]) : null);
    return { ...base, enemyId };
  }
  if (r.type === 'loot') {
    // keep authored loot if present; client can also render from campaign-generated loot
    return { ...base, loot: Array.isArray(r.loot) ? r.loot : [] };
  }
  if (r.type === 'merchant') {
    return {
      ...base,
      merchant: {
        items: r.merchant?.items || [],
        merchantImg: r.merchant?.merchantImg || null,
        frameImg: r.merchant?.frameImg || null,
        dialogue: r.merchant?.dialogue || {},
      }
    };
  }
  if (r.type === 'event') {
    return {
      ...base,
      event: {
        kind: r.event?.kind || 'story-only',
        characterImg: (r.event?.kind === 'meet-loot')
          ? (r.event?.characterImg || null)
          : null,
        effects: r.event?.effects || [],
        vnText: r.event?.vnText || []
      }
    };
  }
  if (r.type === 'rest') {
    // include any authored rest data here if you have it later
    return { ...base };
  }
  return base;
};

// fetch a batch of authored rooms for given types and index by _id & type
async function fetchAuthoredRoomsByTypes(types) {
  const docs = await Room.find({ type: { $in: Array.from(new Set(types)) } }).lean();
  const byId = new Map(docs.map(d => [String(d._id), d]));
  const byType = docs.reduce((m, d) => {
    (m[d.type] ||= []).push(d);
    return m;
  }, {});
  return { byId, byType };
}

// get a random authored room of the given type, if any
function pickRandomAuthored(byType, type) {
  const arr = byType[type] || [];
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate rooms on-the-fly using helper functions and (optional) campaign generator config
const generateCampaignRooms = async (req, res) => {
  try {
    const { id } = req.params; // optional: campaign id to read generator config
    const { length = 6, weights } = req.body || {};
    // prefer body.length, then campaign.length, else 6
    let len = clamp(length, 1, 100);

    let campaign = null;
    if (id) campaign = await Campaign.findById(id).lean();
    if (!length && campaign && Number.isFinite(campaign.length)) {
      len = clamp(campaign.length, 1, 100);
    }

    // default weights if none provided or campaign has none
    const w = Array.isArray(weights) && weights.length
      ? weights
      : (campaign?.generator?.roomWeights ?? [
          { type: 'combat',   weight: 4 },
          { type: 'loot',     weight: 2 },
          { type: 'merchant', weight: 1 },
          { type: 'event',    weight: 2 }
        ]);

    const rooms = [];
    for (let i = 0; i < len; i++) {
      const isLast = i === len - 1;
      const type = isLast ? 'boss' : pickRoomTypeWeighted(w);
      const room = { index: i, type };
      if (type === 'combat' || type === 'boss') {
        room.enemyId = await pickEnemyId();
      } else if (type === 'loot') {
        room.loot = pickRandomLoot(campaign);
      }
      rooms.push(room);
    }
    return res.json(rooms);
  } catch (e) {
    return res.status(500).json({ message: 'Failed to generate rooms', error: String(e.message || e) });
  }
};

// Return a canonical sequence for a campaign (stored `roomSequence`, or generated fallback)
const getCampaignSequence = async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findById(id).lean();
    // If a run for this user & campaign already exists and isn't finished, resume it
    const force = String(req.query?.force || '').toLowerCase() === '1';
    const existing = await SavedGame.findOne({ user: req.user._id }).lean();

    if (!force && existing && existing.progress?.campaignId && String(existing.progress.campaignId) === String(id)) {
      const seq = Array.isArray(existing.campaign) ? existing.campaign : (existing.progress?.generatedPath || []);
      const idx = Number(existing.roomIndex || 0);
      const finished = Array.isArray(seq) && idx >= seq.length && seq.length > 0;

      if (!finished && Array.isArray(seq) && seq.length) {
        // Touch heartbeat (optional)
        // touch(id, req.user._id);

        return res.json({
          ok: true,
          resumed: true,
          savedGameId: String(existing._id),
          progress: existing.progress,
          roomIndex: existing.roomIndex,
          money: existing.money ?? existing.gold ?? 0,
          sequence: seq
        });
      }
    }
    // else: either force=1 or no existing run → fall through to fresh start

    if (!campaign) return res.status(404).json({ message: 'Not found' });

    // helper: enrich combat/boss rooms with enemy name summaries in one DB roundtrip
    const enrichEnemySummaries = async (seq) => {
      const ids = Array.from(new Set(seq
        .filter(r => r && (r.type === 'combat' || r.type === 'boss') && r.enemyId)
        .map(r => String(r.enemyId))
      ));
      if (!ids.length) return seq;

      const enemies = await Enemy.find({ _id: { $in: ids } }, { _id: 1, name: 1 }).lean();
      const nameById = new Map(enemies.map(e => [String(e._id), e.name || String(e._id)]));

      return seq.map(r => {
        if (!r || (r.type !== 'combat' && r.type !== 'boss')) return r;
        return { ...r, enemyId: r.enemyId ? String(r.enemyId) : null, enemySummary: r.enemyId ? { id: String(r.enemyId), name: nameById.get(String(r.enemyId)) || String(r.enemyId) } : null };
      });
    };

    if (Array.isArray(campaign.roomSequence) && campaign.roomSequence.length) {
      // Hydrate IDs -> Room docs (keep order), or pass-through objects
      const raw = campaign.roomSequence;
      const ids = raw
        .map(r => (typeof r === 'string' || (r && typeof r === 'object' && r._id)) ? (r._id || r) : null)
        .filter(Boolean)
        .map(String);

      let sequence = [];
      if (ids.length) {
        const { byId } = await fetchAuthoredRoomsByTypes([]); // we'll fetch by id directly next line
        // Fetch by ids in one query (lean)
        const docs = await Room.find({ _id: { $in: ids } }).lean();
        const map = new Map(docs.map(d => [String(d._id), d]));
        sequence = raw.map((r, i) => {
          if (typeof r === 'string') {
            const doc = map.get(String(r));
            return pickRoomFields(doc, i);
          }
          if (r && typeof r === 'object' && r._id) {
            const doc = map.get(String(r._id)) || r;
            return pickRoomFields(doc, i);
          }
          // If it's already a room-like object with type
          if (r && typeof r === 'object' && r.type) return pickRoomFields(r, i);
         return pickRoomFields(null, i);
        });
      } else {
        // already objects
        sequence = raw.map((r, i) => pickRoomFields(r, i));
      }
      sequence = await enrichEnemySummaries(sequence);
      return res.json({ sequence, generated: false });
    }

    // fallback: generate based on generator config (kept same as before)
    const len = clamp(campaign.length ?? 6, 1, 100);
    const w = campaign?.generator?.roomWeights ?? [
      { type: 'combat', weight: 4 },
      { type: 'loot', weight: 2 },
      { type: 'merchant', weight: 1 },
      { type: 'event', weight: 2 }
    ];

    // Try to sample authored rooms for non-combat types
    const typesPlanned = [];
    for (let i = 0; i < len; i++) {
      const isLast = i === len - 1;
      const t = isLast ? 'boss' : pickRoomTypeWeighted(w);
      typesPlanned.push(t);
    }
    const { byType } = await fetchAuthoredRoomsByTypes(typesPlanned.filter(t => t !== 'combat' && t !== 'boss'));

    const data = [];
    for (let i = 0; i < len; i++) {
      const isLast = i === len - 1;
      const type = isLast ? 'boss' : typesPlanned[i];
      if (type === 'combat' || type === 'boss') {
        data.push(pickRoomFields({
          _id: new mongoose.Types.ObjectId(),
          type,
          enemyId: await pickEnemyId()
        }, i));
      } else if (type === 'loot') {
        // Prefer authored loot room if any; else use generated loot from campaign
        const authored = pickRandomAuthored(byType, 'loot');
        data.push(pickRoomFields(authored ? { ...authored, type: 'loot' } : { type: 'loot', loot: pickRandomLoot(campaign) }, i));
      } else if (type === 'merchant') {
        const authored = pickRandomAuthored(byType, 'merchant');
        data.push(pickRoomFields(authored ? { ...authored, type: 'merchant' } : { type: 'merchant', merchant: { items: [] } }, i));
      } else if (type === 'event') {
        const authored = pickRandomAuthored(byType, 'event');
        data.push(pickRoomFields(authored ? { ...authored, type: 'event' } : { type: 'event', event: { kind: 'story-only', vnText: [] } }, i));
      } else if (type === 'rest') {
        const authored = pickRandomAuthored(byType, 'rest');
        data.push(pickRoomFields(authored ? { ...authored, type: 'rest' } : { type: 'rest' }, i));
      } else {
        data.push(pickRoomFields({ type }, i));
      }
    }

    const sequence = await enrichEnemySummaries(data);
    return res.json({ sequence, generated: true });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to get sequence', error: String(e.message || e) });
  }
};

module.exports = {
  getDefaultCampaign,
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  generateCampaignRooms,
  getCampaignSequence,
  heartbeat,
  likeCampaign,
  startRun
};
