const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const protect = require('../middleware/auth');

const router = express.Router();
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, avatar: u.avatar, createdAt: u.createdAt });
const send = (res, user, code = 200) => res.status(code).json({ token: signToken(user._id), user: publicUser(user) });

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (name.length < 2) return res.status(400).json({ message: 'Please enter your name.' });
    if (!emailRx.test(email)) return res.status(400).json({ message: 'Please enter a valid email.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({
        message: exists.googleId && !exists.password
          ? 'This email is registered with Google. Please use "Continue with Google".'
          : 'An account with this email already exists.',
      });
    }
    const user = await User.create({ name, email, password });
    send(res, user, 201);
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const user = await User.findOne({ email }).select('+password');
    if (user && !user.password) {
      return res.status(400).json({ message: 'This account uses Google sign-in. Please click "Continue with Google".' });
    }
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    send(res, user);
  } catch (err) { next(err); }
});

// POST /api/auth/google  { credential }  -> verifies Google ID token
router.post('/google', async (req, res, next) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || clientId.startsWith('PASTE_')) {
      return res.status(500).json({ message: 'Google login is not configured on the server.' });
    }
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Missing Google credential.' });

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p.email || !p.email_verified) return res.status(400).json({ message: 'Google email is not verified.' });

    let user = await User.findOne({ $or: [{ googleId: p.sub }, { email: p.email.toLowerCase() }] });
    if (!user) {
      user = await User.create({ name: p.name || p.email.split('@')[0], email: p.email, googleId: p.sub, avatar: p.picture || '' });
    } else {
      if (!user.googleId) user.googleId = p.sub;
      if (!user.avatar && p.picture) user.avatar = p.picture;
      await user.save();
    }
    send(res, user);
  } catch (err) {
    if (/Wrong recipient|Invalid token|Token used too late|audience/i.test(err.message)) {
      return res.status(401).json({ message: 'Google sign-in failed. Check GOOGLE_CLIENT_ID and try again.' });
    }
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', protect, (req, res) => res.json({ user: publicUser(req.user) }));

// PUT /api/auth/profile  { name }
router.put('/profile', protect, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (name.length < 2) return res.status(400).json({ message: 'Name is too short.' });
    req.user.name = name;
    await req.user.save();
    res.json({ user: publicUser(req.user) });
  } catch (err) { next(err); }
});

module.exports = router;
