# TaskFlow – Full Stack Task Manager
HTML + CSS + JS frontend · Node.js + Express backend · MongoDB database · JWT auth · Google login

## Quick start
1. Install Node.js 18+ and have a MongoDB URL (Atlas free tier or local).
2. `npm install`
3. Open `.env` and fill in: `MONGODB_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`
4. `npm start`  (or `npm run dev` for auto-reload)
5. Open http://localhost:5000

## Google login setup
Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → *Web application*.
Add **Authorized JavaScript origins**: `http://localhost:5000` (and your live domain later).
Copy the Client ID into `GOOGLE_CLIENT_ID` in `.env`. (No redirect URI or client secret needed.)

## API
POST /api/auth/register · /login · /google · GET /api/auth/me · PUT /api/auth/profile
GET/POST /api/tasks · PUT/DELETE /api/tasks/:id · GET /api/tasks/stats
