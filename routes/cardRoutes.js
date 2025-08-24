const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const cardController = require('../controllers/cardController');

/**
 * @swagger
 * components:
 *   schemas:
 *     Ability:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Canonical ability name (e.g., Attack, Speed, Regen, Immortality)
 *         power:
 *           type: number
 *           description: Strength of buff/effect; used for Attack/Speed/Regen
 *         potency:
 *           type: number
 *           description: Damage potency; used when card.type includes Physical or Supernatural
 *         defense:
 *           type: number
 *           description: Flat defense added by this ability
 *         activationChance:
 *           type: number
 *           format: float
 *           minimum: 0
 *           maximum: 1
 *         duration:
 *           type: integer
 *           minimum: 0
 *           description: Turn-based duration for time-bound effects
 *         precedence:
 *           type: integer
 *           description: Ordering when multiple effects apply
 *         # Backward-compatibility aliases (deprecated)
 *         ability:
 *           type: string
 *           deprecated: true
 *           description: Alias of "name"
 *         abilityPower:
 *           type: number
 *           deprecated: true
 *           description: Alias of "power"
 *
 *     Card:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *         type:
 *           type: array
 *           description: Canonical list of types. Prefer "type"; "types" is accepted as alias.
 *           items:
 *             type: string
 *             enum: [Physical, Supernatural, Buff]
 *         # Backward-compatibility alias (deprecated)
 *         types:
 *           type: array
 *           deprecated: true
 *           description: Alias of "type"
 *           items:
 *             type: string
 *         rating:
 *           type: string
 *         imageUrl:
 *           type: string
 *         description:
 *           type: string
 *         abilities:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Ability'
 *         spCost:
 *           type: number
 *           default: 1
 *         owner:
 *           type: string
 *
 *     CreateCardRequest:
 *       type: object
 *       required: [name, type]
 *       properties:
 *         name:
 *           type: string
 *         type:
 *           type: array
 *           items:
 *             type: string
 *             enum: [Physical, Supernatural, Buff]
 *           description: Prefer "type" (array). "types" is accepted as alias.
 *         # Backward-compatibility alias (deprecated)
 *         types:
 *           type: array
 *           deprecated: true
 *           items:
 *             type: string
 *         rating:
 *           type: string
 *         imageUrl:
 *           type: string
 *         description:
 *           type: string
 *         abilities:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Ability'
 *         spCost:
 *           type: number
 *           default: 1
 *         owner:
 *           type: string
 *
 *     UpdateCardRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/CreateCardRequest'
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     AbilityV2:
 *       type: object
 *       description: Modern ability model
 *       properties:
 *         type:
 *           type: string
 *           description: Effect type (e.g., Stats Up, Freeze, Ability Shield, Multi-Hit, Durability Negation)
 *         key:
 *           type: string
 *           description: Unique key for this ability within a card (used for linking)
 *         desc:
 *           type: string
 *           description: Optional human description
 *         power:
 *           type: number
 *         duration:
 *           type: integer
 *         activationChance:
 *           type: number
 *           description: Percent chance (0-100). Integers accepted.
 *         precedence:
 *           type: integer
 *           description: Higher precedence resolves earlier; can block/negate lower precedence effects
 *         linkedTo:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items: { type: string }
 *             - type: integer # legacy index, still accepted
 *         multiHit:
 *           type: object
 *           properties:
 *             turns:   { type: integer, minimum: 1 }
 *             link:    { type: string, description: "Usually 'attack'" }
 *             overlap: { type: string, enum: [inherit, separate], default: inherit }
 *             schedule:
 *               type: object
 *               properties:
 *                 type:  { type: string, enum: [random, list] }
 *                 times: { type: integer, minimum: 1, description: "Only when type=random" }
 *                 turns:
 *                   type: array
 *                   items: { type: integer, minimum: 1 }
 *                   description: Only when type=list
 *         durabilityNegation:
 *           type: object
 *           properties:
 *             auto:    { type: boolean, default: true }
 *             schedule:
 *               type: object
 *               properties:
 *                 type:  { type: string, enum: [random, list] }
 *                 times: { type: integer, minimum: 1 }
 *                 turns:
 *                   type: array
 *                   items: { type: integer, minimum: 1 }
 *
 *     CardV2:
 *       type: object
 *       properties:
 *         _id:         { type: string }
 *         name:        { type: string }
 *         type:
 *           type: array
 *           items: { type: string }
 *           description: Prefer "type" (array). "types" still accepted as alias.
 *         types:
 *           type: array
 *           deprecated: true
 *           items: { type: string }
 *         rating:      { type: string }
 *         imageUrl:    { type: string }
 *         description: { type: string }
 *         potency:     { type: number, description: "Top-level potency for attack scaling" }
 *         defense:     { type: number, description: "Top-level defense added when played" }
 *         abilities:
 *           type: array
 *           items: { $ref: '#/components/schemas/AbilityV2' }
 *         spCost:      { type: number, default: 0 }
 *         owner:       { type: string }
 *
 *     CreateCardRequestV2:
 *       allOf:
 *         - $ref: '#/components/schemas/CardV2'
 */

/**
 * @swagger
 * tags:
 *   name: Cards
 *   description: Card management
 */

/**
 * @swagger
 * /api/cards:
 *   post:
 *     summary: Create a new card
 *     tags: [Cards]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCardRequest'
 *           examples:
 *             canonical:
 *               summary: Canonical shape (preferred)
 *               value:
 *                 name: "Power Strike"
 *                 type: ["Physical"]
 *                 rating: "S"
 *                 imageUrl: "https://example.com/power-strike.png"
 *                 description: "A heavy physical blow."
 *                 abilities:
 *                   - name: "Attack"
 *                     power: 2
 *                   - name: "Damage"
 *                     potency: 3
 *                 spCost: 1
 *                 owner: "64f2c..."
 *             legacy:
 *               summary: Legacy aliases (still accepted; deprecated fields)
 *               value:
 *                 name: "Haste"
 *                 types: ["Buff"]
 *                 abilities:
 *                   - ability: "Speed"
 *                     abilityPower: 1
 *                 spCost: 1
 *     responses:
 *       201:
 *         description: Card created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Card'
 *       400:
 *         description: Card creation failed
 */
router.post('/', auth, cardController.createCard);

/**
 * @swagger
 * /api/cards/bulk:
 *   post:
 *     summary: Create multiple cards
 *     description: Accepts either an array of cards or an object with a `cards` array. Examples below demonstrate both legacy ability fields and the newer ability model (type/key/linkedTo/multiHit).
 *     tags: [Cards]
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
 *                   $ref: '#/components/schemas/CreateCardRequest'
 *               - type: object
 *                 properties:
 *                   cards:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/CreateCardRequest'
 *           examples:
 *             modernAbilities:
 *               summary: Array payload using modern ability fields
 *               value:
 *                 - name: "Blazing Flurry"
 *                   type: ["Physical","Attack"]
 *                   rating: "R"
 *                   description: "A rapid flurry of strikes."
 *                   potency: 8
 *                   spCost: 2
 *                   abilities:
 *                     - type: "Multi-Hit"
 *                       key: "Flurry_MH"
 *                       multiHit:
 *                         turns: 3
 *                         link: "attack"
 *                         overlap: "inherit"
 *                         schedule: { type: "list", turns: [1,2,3] }
 *                     - type: "Durability Negation"
 *                       key: "DN_Auto"
 *                       durabilityNegation: { auto: true }
 *                     - type: "Stats Up"
 *                       key: "AtkUp"
 *                       power: 2
 *                       duration: 2
 *                       linkedTo: 1
 *                 - name: "Nullify Seal"
 *                   type: ["Debuff","Utility"]
 *                   rating: "G"
 *                   description: "Seal an enemy ability."
 *                   spCost: 2
 *                   abilities:
 *                     - type: "Ability Negation"
 *                       key: "Seal"
 *                       power: 1
 *                       duration: 1
 *                     - type: "Ability Shield"
 *                       key: "SelfShield"
 *                       duration: 1
 *             objectWithCards:
 *               summary: Object payload with `cards` array
 *               value:
 *                 cards:
 *                   - name: "Time Freeze"
 *                     type: ["Utility","Debuff"]
 *                     rating: "U"
 *                     description: "Briefly freeze the opponent."
 *                     spCost: 3
 *                     abilities: [ { type: "Freeze", key: "Freeze_1T", duration: 1, activationChance: 75 } ]
 *                   - name: "Phoenix Feather"
 *                     type: ["Buff"]
 *                     rating: "G"
 *                     description: "Rise from the ashes."
 *                     spCost: 3
 *                     abilities: [ { type: "Revive", key: "SelfRevive50", power: 50 } ]
 *     responses:
 *       201:
 *         description: Cards created
 *       400:
 *         description: Bulk card creation failed
 */
router.post('/bulk', auth, cardController.createCardsBulk);

/**
 * @swagger
 * /api/cards/bulk/array:
 *   post:
 *     summary: Create multiple cards (array payload)
 *     description: Array-only version of bulk creation. Supports modern abilities (type/key/desc/linkedTo/multiHit/durabilityNegation) and top-level potency/defense on the card.
 *     tags: [Cards]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/CreateCardRequestV2'
 *           examples:
 *             fullModern:
 *               summary: Modern cards using all new fields
 *               value:
 *                 - name: "Blazing Flurry"
 *                   type: ["Physical","Attack"]
 *                   rating: "R"
 *                   description: "A rapid flurry of strikes."
 *                   potency: 8
 *                   spCost: 2
 *                   abilities:
 *                     - type: "Multi-Hit"
 *                       key: "Flurry_MH"
 *                       desc: "3 scheduled slashes"
 *                       multiHit:
 *                         turns: 3
 *                         link: "attack"
 *                         overlap: "inherit"
 *                         schedule: { type: "list", turns: [1,2,3] }
 *                     - type: "Durability Negation"
 *                       key: "DN_Auto"
 *                       durabilityNegation: { auto: true }
 *                     - type: "Stats Up"
 *                       key: "AtkUp"
 *                       power: 2
 *                       duration: 2
 *                       linkedTo: 1              # legacy index OK
 *                 - name: "Guardian Stance"
 *                   type: ["Buff","Utility"]
 *                   rating: "G"
 *                   description: "Assume a protective posture."
 *                   defense: 10
 *                   spCost: 1
 *                   abilities:
 *                     - type: "Guard"
 *                       key: "Guard_1T"
 *                       duration: 1
 *                       precedence: 2
 *                     - type: "Stats Up"
 *                       key: "DurUp"
 *                       power: 3
 *                       duration: 2
 *                 - name: "Nullify Seal"
 *                   type: ["Debuff","Utility"]
 *                   rating: "G"
 *                   description: "Seal an enemy ability."
 *                   spCost: 2
 *                   abilities:
 *                     - type: "Ability Negation"
 *                       key: "Seal"
 *                       power: 1
 *                       duration: 1
 *                       precedence: 3
 *                     - type: "Ability Shield"
 *                       key: "SelfShield"
 *                       duration: 1
 *                       precedence: 2
 *                 - name: "Time Freeze"
 *                   type: ["Utility","Debuff"]
 *                   rating: "U"
 *                   description: "Briefly freeze the opponent."
 *                   spCost: 3
 *                   abilities:
 *                     - type: "Freeze"
 *                       key: "Freeze_1T"
 *                       duration: 1
 *                       activationChance: 75
 *                 - name: "Razor Waltz"
 *                   type: ["Physical","Attack"]
 *                   rating: "R"
 *                   description: "Dance of blades with staggered DN."
 *                   potency: 6
 *                   spCost: 2
 *                   abilities:
 *                     - type: "Multi-Hit"
 *                       key: "Waltz_MH"
 *                       multiHit:
 *                         turns: 4
 *                         link: "attack"
 *                         overlap: "inherit"
 *                         schedule: { type: "random", times: 3 }
 *                     - type: "Durability Negation"
 *                       key: "Waltz_DN"
 *                       durabilityNegation:
 *                         auto: false
 *                         schedule: { type: "list", turns: [2,4] }
 *     responses:
 *       201:
 *         description: Cards created
 *       400:
 *         description: Bulk card creation failed
 */
router.post('/bulk/array', auth, cardController.createCardsBulk); // reuse existing handler

/**
 * @swagger
 * /api/cards:
 *   get:
 *     summary: Get all cards
 *     tags: [Cards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of cards
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Card'
 */
router.get('/', auth, cardController.getAllCards);

/**
 * @swagger
 * /api/cards:
 *   delete:
 *     summary: Delete ALL cards
 *     description: Danger zone. Permanently deletes all cards in the database.
 *     tags: [Cards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deletion summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: All cards deleted
 *                 deletedCount:
 *                   type: integer
 */
router.delete('/', cardController.deleteAllCards);

/**
 * @swagger
 * /api/cards/{id}:
 *   get:
 *     summary: Get card by ID
 *     tags: [Cards]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Card ID
 *     responses:
 *       200:
 *         description: Card found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Card'
 *       404:
 *         description: Card not found
 */
router.get('/:id', cardController.getCard);

/**
 * @swagger
 * /api/cards/{id}:
 *   put:
 *     summary: Update a card by ID
 *     tags: [Cards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Card ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCardRequest'
 *     responses:
 *       200:
 *         description: Card updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Card'
 *       404:
 *         description: Card not found
 *       400:
 *         description: Card update failed
 */
router.put('/:id', auth, cardController.updateCard);
router.patch('/:id', auth, cardController.updateCard);
/**
 * @swagger
 * /api/cards/{id}:
 *   delete:
 *     summary: Delete a card by ID
 *     tags: [Cards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Card ID
 *     responses:
 *       200:
 *         description: Card deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Card deleted
 *                 card:
 *                   $ref: '#/components/schemas/Card'
 *       404:
 *         description: Card not found
 */
router.delete('/:id', auth, cardController.deleteCard);

module.exports = router;
