const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuth');
const {
  createCampaign,
  listCampaigns,
  getCampaignById: getCampaign,
  updateCampaign,
  deleteCampaign,
  generateCampaignRooms: generateCampaign,
  getCampaignSequence: getSequence,
  getDefaultCampaign,
  heartbeat,
  likeCampaign,
  startRun
} = require('../controllers/campaignController');

/**
 * @swagger
 * components:
 *   schemas:
 *     PlayerInitialStats:
 *       type: object
 *       properties:
 *         attackPower:        { type: number }
 *         physicalPower:      { type: number }
 *         supernaturalPower:  { type: number }
 *         durability:         { type: number }
 *         vitality:           { type: number }
 *         intelligence:       { type: number }
 *         speed:              { type: number }
 *         sp:                 { type: number }
 *         maxSp:              { type: number }
 *         hp:                 { type: number, description: "Optional explicit base HP; otherwise derived from vitality." }
 *
 *     PlayerSetup:
 *       type: object
 *       properties:
 *         startingDeck:
 *           type: array
 *           description: Array of { cardId, qty }. Expanded and shuffled at run start.
 *           items: { $ref: '#/components/schemas/StartingDeckEntry' }
 *         startingHandSize:
 *           type: integer
 *           minimum: 0
 *           maximum: 10
 *           default: 5
 *         minDeckSize:
 *           type: integer
 *           minimum: 0
 *           maximum: 30
 *           default: 10
 *         maxDeckSize:
 *           type: integer
 *           minimum: 1
 *           maximum: 30
 *           default: 30
 *         initialStats:
 *           $ref: '#/components/schemas/PlayerInitialStats'
 *
 *     RandomLootItem:
 *       type: object
 *       properties:
 *         kind:   { type: string, enum: [card, money, statBuff] }
 *         cardId: { type: string }
 *         amount: { type: number }
 *         stat:
 *           type: string
 *           enum:
 *             - attackPower
 *             - physicalPower
 *             - supernaturalPower
 *             - durability
 *             - vitality
 *             - intelligence
 *             - speed
 *     RandomLoot:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RandomLootItem'
 *         maxPicks:
 *           type: integer
 *           minimum: 1
 *           maximum: 3
 *
 *     Campaign:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *         cover:
 *           $ref: '#/components/schemas/TinyImage'
 *         length:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         likes:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         playerSetup:
 *           $ref: '#/components/schemas/PlayerSetup'
 *         generator:
 *           type: object
 *           properties:
 *             useWeighted:
 *               type: boolean
 *               default: true
 *             roomWeights:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WeightedType'
 *             insertRestBefore:
 *               type: string
 *               enum: [combat, boss, none]
 *               default: boss
 *             enemiesMin:
 *               type: integer
 *               minimum: 1
 *               maximum: 4
 *               default: 1
 *             enemiesMax:
 *               type: integer
 *               minimum: 1
 *               maximum: 4
 *               default: 3
 *             bossMin:
 *               type: integer
 *               minimum: 1
 *               maximum: 4
 *               default: 1
 *             bossMax:
 *               type: integer
 *               minimum: 1
 *               maximum: 4
 *               default: 3
 *             randomLoot:
 *               $ref: '#/components/schemas/RandomLoot'
 *         roomSequence:
 *           type: array
 *           description: Hand-crafted room order; if present, overrides generator
 *           items:
 *             type: string
 *             description: Room ObjectId
 *
 *     CreateCampaignRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/Campaign'
 *
 *     UpdateCampaignRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/Campaign'
 */

/**
 * @swagger
 * /api/campaigns:
 *   get:
 *     summary: List campaigns (mine)
 *     tags:
 *       - Campaigns
 *     responses:
 *       200:
 *         description: List of campaigns (each item includes `likes` and computed `playingNow`)
 */
router.get('/', optionalAuth, listCampaigns);

/**
 * @swagger
 * /api/campaigns:
 *   post:
 *     summary: Create a campaign
 *     tags:
 *       - Campaigns
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCampaignRequest'
 *     responses:
 *       201:
 *         description: Campaign created
 *       400:
 *         description: Campaign creation failed
 */
router.post('/', auth, createCampaign);

/**
 * @swagger
 * /api/campaigns/{id}:
 *   get:
 *     summary: Get a campaign by ID
 *     tags:
 *       - Campaigns
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign (includes `likes` and computed `playingNow`)
 *       404:
 *         description: Not found
 */
router.get('/:id', getCampaign);

/**
 * @swagger
 * /api/campaigns/{id}:
 *   patch:
 *     summary: Update a campaign
 *     tags:
 *       - Campaigns
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCampaignRequest'
 *     responses:
 *       200:
 *         description: Campaign updated
 *       404:
 *         description: Not found
 */
router.patch('/:id', auth, updateCampaign);

/**
 * @swagger
 * /api/campaigns/{id}:
 *   delete:
 *     summary: Delete a campaign
 *     tags:
 *       - Campaigns
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign deleted
 *       404:
 *         description: Not found
 */
router.delete('/:id', auth, deleteCampaign);

/**
 * @swagger
 * /api/campaigns/{id}/like:
 *   post:
 *     summary: Like this campaign (increments like counter)
 *     tags:
 *       - Campaigns
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: New like count
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Campaign not found
 */
router.post('/:id/like', auth, likeCampaign);

/**
 * @swagger
 * /api/campaigns/{id}/heartbeat:
 *   post:
 *     summary: Heartbeat to indicate a user is currently playing this campaign
 *     description: Send every ~30s while a run is active; server uses a 90s TTL for "playing now".
 *     tags:
 *       - Campaigns
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns current `playingNow`
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Campaign not found
 */
router.post('/:id/heartbeat', auth, heartbeat);

/**
 * @swagger
 * /api/campaigns/{id}/generate:
 *   post:
 *     summary: Generate a concrete room path from this campaign's editable generator
 *     tags:
 *       - Campaigns
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               length:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *     responses:
 *       200:
 *         description: Generated room DTOs
 *       404:
 *         description: Campaign not found
 */
router.post('/:id/generate', generateCampaign);

/**
 * @swagger
 * /api/campaigns/{id}/sequence:
 *   get:
 *     summary: Get the hand-crafted room sequence (if present), or a generated fallback
 *     tags:
 *       - Campaigns
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Room list (populated or generated)
 *       404:
 *         description: Campaign not found
 */
router.get('/:id/sequence', getSequence);

/**
 * @swagger
 * /api/campaigns/default/{length}:
 *   get:
 *     summary: Generate a default campaign of specified length
 *     tags:
 *       - Campaigns
 *     parameters:
 *       - in: path
 *         name: length
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Campaign generated
 */
router.get('/default/:length', getDefaultCampaign);
router.post('/:id/start', auth, startRun);
module.exports = router;
