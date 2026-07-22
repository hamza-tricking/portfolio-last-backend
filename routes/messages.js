const router = require('express').Router();
const { sendMessage, getAllMessages, getMyMessages, getMessage, deleteMessage } = require('../controllers/messageController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);

router.post('/', adminOnly, sendMessage);
router.get('/', adminOnly, getAllMessages);
router.get('/my', getMyMessages);
router.get('/:id', getMessage);
router.delete('/:id', adminOnly, deleteMessage);

module.exports = router;
