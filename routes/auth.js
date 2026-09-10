const router = require('express').Router();
const { register, login, refresh, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.get('/me', protect, getMe);

module.exports = router;
