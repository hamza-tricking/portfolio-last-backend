const router = require('express').Router();
const { register, login, refresh, getMe, syncProgress } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.get('/me', protect, getMe);
router.put('/progress', protect, syncProgress);

module.exports = router;
