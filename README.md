# Student Life Manager — MongoDB Upgrade

## Added
- MongoDB + Mongoose centralized persistence
- bcrypt password hashing
- JWT authentication in an HttpOnly cookie (`slm_token`); the token is never stored in localStorage
- Advanced drag-and-drop reordering for tasks and assignments
- Expense doughnut chart and attendance bar chart using Chart.js
- Service Worker + Web Notifications API deadline reminders
- Offline shell caching
- Existing responsive layout, dark mode, profile cropper, search, modules and dashboard retained

## Important architecture change
A browser-only HTML/CSS/JS app cannot securely connect directly to MongoDB. The upgrade therefore adds a small Node.js/Express API. MongoDB credentials and JWT secrets stay on the server.

## Local setup
1. Install Node.js 18+.
2. Create a MongoDB Atlas cluster and database user.
3. Copy `.env.example` to `.env` and fill in `MONGODB_URI` and a strong `JWT_SECRET`.
4. Run `npm install`.
5. Run `npm start`.
6. Open the frontend through a local web server, not `file://` (for example VS Code Live Server). If the frontend is served by the same Express app, use `http://localhost:5000`.

## Netlify frontend + separate backend
Deploy the backend to Render/Railway/Fly.io/etc. Set `FRONTEND_ORIGIN` to the exact Netlify URL. Then change the `api-base` meta tag in `index.html` from `/api` to `https://YOUR-BACKEND-DOMAIN/api`.

Because the auth cookie is cross-site in this arrangement, the backend uses `SameSite=None; Secure` and the frontend requests use `credentials: include`.

## Real push notifications
The included notification system is browser-local deadline notification using a Service Worker. It does not pretend to be a remote push service. For true server-triggered push while the site is closed, add Push API + VAPID subscriptions and a scheduled server job later.

## Password reset email
The app now has **Forgot password** with a 6-digit email verification code. The code is hashed in MongoDB and expires after 10 minutes. Configure SMTP in `.env` (Gmail requires a Google App Password, not your normal account password).

## Important: fixing 405 on Netlify
Netlify hosts the static frontend, but it does not run `server.js` as an Express server. A `POST /api/auth/login` or `/api/auth/register` sent to a normal Netlify site can therefore return **405 Method Not Allowed**.

Run/deploy the Node backend separately (for example on Render/Railway/Fly.io), connect it to MongoDB Atlas, then change the `api-base` meta tag in `index.html` from `http://localhost:5000/api` to your deployed backend URL ending in `/api`.

Example:
`<meta name="api-base" content="https://your-backend.example.com/api">`

Set the backend environment variable `FRONTEND_ORIGIN` to the exact Netlify site URL. Also set the SMTP variables shown in `.env.example`.
