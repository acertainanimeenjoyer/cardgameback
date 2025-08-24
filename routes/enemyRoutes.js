const express = require('express');
const router = express.Router();
const {
  createEnemy,
  getEnemies,
  getEnemyById,
  updateEnemy,
  deleteEnemy,
  createEnemiesBulk,
} = require('../controllers/enemyController');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuth');

/**
 * @swagger
 * tags:
 *   name: Enemies
 *   description: Enemy management
 */

/**
 * @swagger
 * /api/enemies:
 *   get:
 *     summary: Get my enemies
 *     tags: [Enemies]
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [mine, all]
 *         description: "Default: mine (when bearer token is supplied). Use 'all' to list all enemies."
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of enemies
 */
router.get('/', authMiddleware, getEnemies);

/**
 * @swagger
 * /api/enemies/{id}:
 *   get:
 *     summary: Get enemy by ID
 *     tags: [Enemies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Enemy ID
 *     responses:
 *       200:
 *         description: Enemy data
 *       404:
 *         description: Enemy not found
 */
router.get('/:id', getEnemyById);

/**
 * @swagger
 * /api/enemies:
 *   post:
 *     summary: Create a new enemy
 *     tags: [Enemies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Enemy created
 *       400:
 *         description: Enemy creation failed
 */
router.post('/', authMiddleware, createEnemy);

/**
 * @swagger
 * /api/enemies/bulk:
 *   post:
 *     summary: Create multiple enemies
 *     description: Accepts either an array of enemies or an object with an `enemies` array.
 *     tags: [Enemies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: array
 *                 items:
 *                   $ref: '#/components/schemas/createEnemy'
 *               - type: object
 *                 properties:
 *                   enemies:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/createEnemy'
 *           examples:
 *             arrayPayload:
 *               summary: Array payload
 *               value:
 *                 - name: "Combo Goblin"
 *                   stats: { physicalPower: 12, durability: 6, vitality: 2, sp: 3, maxSp: 5 }
 *                   description: "Loves setting up."
 *                   moveSet: ["<CARD_ID_FLURRY>", "<CARD_ID_GUARD>", "<CARD_ID_NULLIFY>"]
 *                   aiConfig:
 *                     cardPriority:
 *                       - { cardId: "<CARD_ID_FLURRY>", priority: 10 }
 *                       - { cardId: "<CARD_ID_NULLIFY>", priority: 8 }
 *                     combos:
 *                       - { cards: ["<CARD_ID_GUARD>","<CARD_ID_FLURRY>"], priority: 11 }
 *                     spSkipThreshold: 0.3
 *                     defendHpThreshold: 0.5
 *                     skipForComboThreshold: 1.25
 *                     weights: { play: 1, skip: 1, defend: 1 }
 *                     greedChance: 0.15
 *                 - name: "Hex Wisp"
 *                   stats: { supernaturalPower: 14, durability: 5, vitality: 1, sp: 4, maxSp: 6 }
 *                   description: "A whispering spirit of curses."
 *                   moveSet: ["<CARD_ID_CURSE_BLADE>", "<CARD_ID_TIME_FREEZE>", "<CARD_ID_INSTANT_DOOM>"]
 *                   aiConfig:
 *                     cardPriority:
 *                       - { cardId: "<CARD_ID_INSTANT_DOOM>", priority: 9 }
 *                     combos:
 *                       - { cards: ["<CARD_ID_TIME_FREEZE>","<CARD_ID_INSTANT_DOOM>"], priority: 13 }
 *             objectPayload:
 *               summary: Object with `enemies` array
 *               value:
 *                 enemies:
 *                   - name: "Trial Dummy"
 *                     stats: { durability: 8, vitality: 2, sp: 3, maxSp: 5 }
 *                     description: "A basic training target."
 *                     moveSet: ["<CARD_ID_FLURRY>", "<CARD_ID_GUARD>", "<CARD_ID_FREEZE>"]
 *     responses:
 *       201:
 *         description: Enemies created
 *       400:
 *         description: Bulk enemy creation failed
 */
router.post('/bulk', authMiddleware, createEnemiesBulk);

/**
 * @swagger
 * /api/enemies/{id}:
 *   put:
 *     summary: Update an enemy
 *     tags: [Enemies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Enemy ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Enemy updated
 *       404:
 *         description: Enemy not found
 */
router.put('/:id', authMiddleware, updateEnemy);
router.patch('/:id', authMiddleware, updateEnemy);
/**
 * @swagger
 * /api/enemies/{id}:
 *   delete:
 *     summary: Delete an enemy
 *     tags: [Enemies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Enemy ID
 *     responses:
 *       200:
 *         description: Enemy deleted
 *       404:
 *         description: Enemy not found
 */
router.delete('/:id', authMiddleware, deleteEnemy);

module.exports = router;
