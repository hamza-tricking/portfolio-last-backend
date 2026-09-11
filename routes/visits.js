const router = require('express').Router();
const { recordVisit, updateVisit, getVisits, getVisitorJourney } = require('../controllers/visitController');
const { optionalAuth, protect, adminOnly } = require('../middleware/auth');

// Public — optionalAuth so logged-in user is linked if token present
router.post('/', optionalAuth, recordVisit);
router.patch('/:sessionId', updateVisit);  // called via sendBeacon, no auth header available

// Admin only
router.get('/', protect, adminOnly, getVisits);
router.get('/journey/:visitorId', protect, adminOnly, getVisitorJourney);

module.exports = router;
