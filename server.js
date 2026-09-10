import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';

if (!process.env.MONGODB_URI || !JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET in .env');
  process.exit(1);
}

app.use(cors({
  origin: FRONTEND_ORIGIN || true,
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  college: { type: String, required: true },
  course: { type: String, required: true },
  department: { type: String, required: true },
  year: { type: String, required: true },
  passwordHash: { type: String, required: true, select: false },
  data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  resetCodeHash: { type: String, select: false },
  resetCodeExpires: { type: Date, select: false }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const mailer = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}


const publicUser = user => ({
  name: user.name, email: user.email, college: user.college,
  course: user.course, department: user.department, year: user.year,
  ...(user.data?.photo ? { photo: user.data.photo } : {})
});

function tokenFor(user) {
  return jwt.sign({ sub: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function cookieOptions() {
  const crossSite = FRONTEND_ORIGIN && !FRONTEND_ORIGIN.includes('localhost');
  return { httpOnly: true, secure: crossSite || process.env.NODE_ENV === 'production', sameSite: crossSite ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' };
}
function setAuthCookie(res, user) { res.cookie('slm_token', tokenFor(user), cookieOptions()); }
async function auth(req, res, next) {
  try {
    const raw = req.cookies.slm_token;
    if (!raw) return res.status(401).json({ message: 'Not authenticated' });
    const decoded = jwt.verify(raw, JWT_SECRET);
    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ message: 'Session expired' });
    req.user = user;
    next();
  } catch { res.status(401).json({ message: 'Session expired' }); }
}

app.get('/api/health', (req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, college, course, department, year, password } = req.body || {};
    if (![name,email,college,course,department,year,password].every(v => typeof v === 'string' && v.trim())) return res.status(400).json({ message: 'Please fill in every field.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' });
    const exists = await User.exists({ email: email.toLowerCase().trim() });
    if (exists) return res.status(409).json({ message: 'An account with this email already exists. Please login.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name: name.trim(), email: email.toLowerCase().trim(), college: college.trim(), course, department, year, passwordHash, data: { theme:'light', tasks:[], assignments:[], exams:[], timetable:[], attendance:[], expenses:[], goals:[], notes:[], settings:{emailReminders:false,reminderWindow:'1'} } });
    setAuthCookie(res, user);
    return res.status(201).json({ user: publicUser(user), ...user.data });
  } catch (e) { console.error(e); return res.status(500).json({ message: 'Registration failed.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email: String(email || '').toLowerCase().trim() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return res.status(401).json({ message: 'Incorrect email or password.' });
    setAuthCookie(res, user);
    return res.json({ user: publicUser(user), ...user.data });
  } catch (e) { console.error(e); return res.status(500).json({ message: 'Login failed.' }); }
});


app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ message: 'Enter your email address.' });
    if (!mailer) return res.status(503).json({ message: 'Email service is not configured on the server yet.' });

    const user = await User.findOne({ email }).select('+resetCodeHash +resetCodeExpires');
    // Do not reveal whether an email is registered.
    if (!user) return res.json({ ok: true, message: 'If that email is registered, a verification code has been sent.' });

    const code = String(crypto.randomInt(100000, 1000000));
    user.resetCodeHash = hashCode(code);
    user.resetCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: 'Student Life Manager password reset code',
      text: `Your Student Life Manager verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Student Life Manager</h2><p>Your password reset verification code is:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;padding:18px;background:#f3f6ff;border-radius:12px;text-align:center">${code}</div><p>This code expires in <b>10 minutes</b>.</p><p>If you did not request this, you can safely ignore this email.</p></div>`
    });
    res.json({ ok: true, message: 'Verification code sent to your email.' });
  } catch (e) { console.error('Forgot password error:', e); res.status(500).json({ message: 'Could not send the verification email.' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ message: 'Enter the 6-digit verification code.' });
    if (newPassword.length < 8) return res.status(400).json({ message: 'New password must contain at least 8 characters.' });
    const user = await User.findOne({ email }).select('+resetCodeHash +resetCodeExpires');
    if (!user || !user.resetCodeHash || !user.resetCodeExpires || user.resetCodeExpires.getTime() < Date.now() || !crypto.timingSafeEqual(Buffer.from(hashCode(code)), Buffer.from(user.resetCodeHash))) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetCodeHash = undefined;
    user.resetCodeExpires = undefined;
    await user.save();
    setAuthCookie(res, user);
    res.json({ ok: true, user: publicUser(user), ...(user.data || {}), message: 'Password reset successfully.' });
  } catch (e) { console.error('Reset password error:', e); res.status(500).json({ message: 'Could not reset your password.' }); }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.post('/api/auth/logout', (req, res) => { res.clearCookie('slm_token', cookieOptions()); res.json({ ok: true }); });

app.post('/api/auth/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) return res.status(400).json({ message: 'Use a new password with at least 8 characters.' });
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ message: 'Current password is incorrect.' });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  res.json({ ok: true });
});

app.get('/api/data', auth, (req, res) => res.json({ user: publicUser(req.user), ...(req.user.data || {}) }));
app.put('/api/data', auth, async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = ['theme','tasks','assignments','exams','timetable','attendance','expenses','goals','notes','settings'];
    const next = {};
    for (const key of allowed) if (body[key] !== undefined) next[key] = body[key];
    if (body.user) {
      const u = body.user;
      for (const key of ['name','email','college','course','department','year']) if (typeof u[key] === 'string' && u[key].trim()) req.user[key] = u[key].trim();
      if (u.email) req.user.email = u.email.toLowerCase();
      if (typeof u.photo === 'string') next.photo = u.photo;
      else if (u.photo === null) delete next.photo;
    }
    req.user.data = { ...(req.user.data || {}), ...next };
    await req.user.save();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not save your data.' }); }
});

// Optional same-origin hosting: copy the three frontend files into the project root and this backend can serve them.
app.use(express.static(__dirname));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`Student Life Manager API running on port ${PORT}`)))
  .catch(err => { console.error('MongoDB connection failed:', err); process.exit(1); });
