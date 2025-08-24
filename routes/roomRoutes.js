const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuth');
const {
  // NEW CRUD (controller exports)
  createRoom, listRooms, getRoomById, updateRoom, deleteRoom,
  // NEW typed actions (controller exports)
  getMerchantItems, buyFromMerchant, getLootForRoom, getEventForRoom,
  // LEGACY stubs (controller exports)
  getMerchantItemsLegacy, getLoot, getEvent
} = require('../controllers/roomController');
const roomController = require('../controllers/roomController');
// Aliases to match previous route handler names
const getRoom = getRoomById;
const getMerchantForRoom = getMerchantItems;
const buyMerchantItem = buyFromMerchant;

/**
 * @swagger
 * tags:
 *   name: Rooms
 *   description: Room authoring (CRUD) and room-type actions
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     LootItem:
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
 *     MerchantItem:
 *       type: object
 *       properties:
 *         kind:   { type: string, enum: [card, statBuff] }
 *         cardId: { type: string }
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
 *         value:  { type: number }
 *         price:  { type: number }
 *     Room:
 *       type: object
 *       properties:
 *         _id:  { type: string }
 *         name: { type: string }
 *         type:
 *           type: string
 *           enum: [loot, merchant, event, combat, boss]
 *         backgrounds:
 *           type: array
 *           items: { $ref: '#/components/schemas/TinyImage' }
 *           description: "Max 5 images"
 *         roomAudio:   { $ref: '#/components/schemas/TinyAudio' }
 *         loot:    { type: array, items: { $ref: '#/components/schemas/LootItem' } }
 *         merchant:
 *           type: object
 *           properties:
 *             items:       { type: array, items: { $ref: '#/components/schemas/MerchantItem' } }
 *             merchantImg: { $ref: '#/components/schemas/TinyImage' }
 *             frameImg:    { $ref: '#/components/schemas/TinyImage' }
 *             dialogue:    { $ref: '#/components/schemas/Dialogue' }
 *         event:
 *           type: object
 *           properties:
 *             kind:  { type: string, enum: [meet-loot, no-meet-loot, story-only] }
 *             effects: { type: array, items: { $ref: '#/components/schemas/LootItem' } }
 *             vnText:  { type: array, items: { type: string } }
 */

/**
 * @swagger
 * /api/rooms:
 *   get:
 *     summary: List my rooms
 *     tags: [Rooms]
 *     responses:
 *       200:
 *         description: List of rooms
 */
router.get('/', optionalAuth, listRooms);

/**
 * @swagger
 * /api/rooms:
 *   post:
 *     summary: Create a room
 *     tags: [Rooms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRoomRequest'
 *     responses:
 *       201:
 *         description: Room created
 *       400:
 *         description: Room creation failed
 */
router.post('/', auth, createRoom);

/**
 * @swagger
 * /api/rooms/{id}:
 *   get:
 *     summary: Get a room by ID
 *     tags: [Rooms]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Room found
 *       404:
 *         description: Not found
 */
router.get('/:id', getRoom);

/**
 * @swagger
 * /api/rooms/{id}:
 *   patch:
 *     summary: Update a room
 *     tags: [Rooms]
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
 *             $ref: '#/components/schemas/UpdateRoomRequest'
 *     responses:
 *       200:
 *         description: Room updated
 *       404:
 *         description: Not found
 */
router.patch('/:id', auth, updateRoom);

/**
 * @swagger
 * /api/rooms/{id}:
 *   delete:
 *     summary: Delete a room
 *     tags: [Rooms]
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
 *         description: Room deleted
 *       404:
 *         description: Not found
 */
router.delete('/:id', auth, deleteRoom);

/**
 * @swagger
 * /api/rooms/{id}/merchant:
 *   get:
 *     summary: Get merchant shop for a specific room
 *     tags: [Rooms]
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
 *         description: Shop items
 *       404:
 *         description: Not found
 */
router.get('/:id/merchant', auth, getMerchantForRoom);

/**
 * @swagger
 * /api/rooms/{id}/merchant/buy:
 *   post:
 *     summary: Buy an item from the merchant
 *     tags: [Rooms]
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
 *             type: object
 *             properties:
 *               itemIndex: { type: integer, minimum: 0 }
 *     responses:
 *       200:
 *         description: Purchase result
 *       400:
 *         description: Not enough money / invalid
 *       404:
 *         description: Not found
 */
router.post('/:id/merchant/buy', auth, buyMerchantItem);

/**
 * @swagger
 * /api/rooms/{id}/loot:
 *   get:
 *     summary: Get loot for a specific room
 *     tags: [Rooms]
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
 *         description: Loot items
 *       404:
 *         description: Not found
 */
router.get('/:id/loot', auth, getLootForRoom);

/**
 * @swagger
 * /api/rooms/{id}/event:
 *   get:
 *     summary: Get event data for a specific room
 *     tags: [Rooms]
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
 *         description: Event payload
 *       404:
 *         description: Not found
 */
router.get('/:id/event', auth, getEventForRoom);

/**
 * @swagger
 * /api/rooms/merchant:
 *   get:
 *     deprecated: true
 *     summary: "[Deprecated] Get merchant shop items for the current room"
 *     tags: [Rooms]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Shop items returned
 */
router.get('/merchant', auth, getMerchantItemsLegacy);

/**
 * @swagger
 * /api/rooms/loot:
 *   get:
 *     deprecated: true
 *     summary: "[Deprecated] Get loot for the current room"
 *     tags: [Rooms]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Loot returned
 */
router.get('/loot', auth, getLoot);

/**
 * @swagger
 * /api/rooms/event:
 *   get:
 *     deprecated: true
 *     summary: "[Deprecated] Get event payload for the current room"
 *     tags: [Rooms]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Event returned
 */
router.get('/event', auth, getEvent);

module.exports = router;
