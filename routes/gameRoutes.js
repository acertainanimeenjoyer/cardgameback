const express = require('express');
const router = express.Router();
const { saveState, loadState, clearState, playTurn, patchState } = require('../controllers/gameController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   - name: Game
 *     description: Game state and play routes
 */

/**
 * @swagger
 * /api/game/save:
 *   post:
 *     summary: Save the current game state (shallow merge)
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: When provided and player piles are empty, seed from Campaign.playerSetup
 *               roomIndex:
 *                 type: number
 *               money:
 *                 type: number
 *               extraDeck:
 *                 type: array
 *                 description: Run-only additive deck entries
 *                 items:
 *                   type: object
 *                   properties:
 *                     cardId:
 *                       type: string
 *                     qty:
 *                       type: integer
 *                       minimum: 1
 *                       maximum: 30
 *                       default: 1
 *               extraStats:
 *                 type: object
 *                 description: Run-only additive stat deltas; allow negatives
 *                 properties:
 *                   attackPower:        { type: number, default: 0 }
 *                   physicalPower:      { type: number, default: 0 }
 *                   supernaturalPower:  { type: number, default: 0 }
 *                   durability:         { type: number, default: 0 }
 *                   vitality:           { type: number, default: 0 }
 *                   intelligence:       { type: number, default: 0 }
 *                   speed:              { type: number, default: 0 }
 *                   sp:                 { type: number, default: 0 }
 *                   maxSp:              { type: number, default: 0 }
 *                   hp:                 { type: number, default: 0, description: Optional additive HP delta }
 *               playerStats:
 *                 type: object
 *               enemy:
 *                 type: object
 *               deck:
 *                 type: array
 *                 items:
 *                   type: object
 *               hand:
 *                 type: array
 *                 items:
 *                   type: object
 *               selectedCards:
 *                 type: array
 *                 items:
 *                   type: object
 *               discardPile:
 *                 type: array
 *                 items:
 *                   type: object
 *               campaign:
 *                 type: object
 *               gold:
 *                 type: number
 *                 deprecated: true
 *                 description: Legacy currency; prefer "money"
 *     responses:
 *       '200':
 *         description: Game state updated
 *       '400':
 *         description: Bad request (e.g., empty body)
 */
router.post('/save', authMiddleware, saveState);

/**
 * @swagger
 * /api/game/save:
 *   patch:
 *     summary: Partially update the saved game (PATCH)
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Provide only the fields you want to update
 *             properties:
 *               money:
 *                 type: number
 *               extraDeck:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     cardId:
 *                       type: string
 *                     qty:
 *                       type: integer
 *                       minimum: 1
 *                       maximum: 30
 *               extraStats:
 *                 type: object
 *                 properties:
 *                   attackPower:        { type: number }
 *                   physicalPower:      { type: number }
 *                   supernaturalPower:  { type: number }
 *                   durability:         { type: number }
 *                   vitality:           { type: number }
 *                   intelligence:       { type: number }
 *                   speed:              { type: number }
 *                   sp:                 { type: number }
 *                   maxSp:              { type: number }
 *                   hp:                 { type: number }
 *     responses:
 *       '200':
 *         description: Game state patched
 *       '400':
 *         description: No game data provided
 */
router.patch('/save', authMiddleware, patchState);

/**
 * @swagger
 * /api/game/load:
 *   get:
 *     summary: Load the saved game state for the user
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saved game state returned
 *       404:
 *         description: No saved game found
 */
router.get('/load', authMiddleware, loadState);
router.get('/save', authMiddleware, loadState);
router.delete('/save', authMiddleware, clearState);
/**
 * @swagger
 * /api/game/play:
 *   post:
 *     summary: Play a turn in combat
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               selectedCards:
 *                 type: array
 *                 items:
 *                   type: string
 *               playerStats:
 *                 type: object
 *               enemyId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Combat results
 *       400:
 *         description: Invalid request
 */
router.post('/play', authMiddleware, playTurn);

module.exports = router;
