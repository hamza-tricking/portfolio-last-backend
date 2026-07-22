const router = require('express').Router();
const { getUsers, getUser } = require('../controllers/userController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect, adminOnly);

router.get('/', getUsers);
router.get('/:id', getUser);

module.exports = router;
