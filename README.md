# Ironhouse Gym Manager

Ironhouse is a responsive gym operations dashboard for membership management, attendance, class scheduling, coach profiles, class bookings, and payment tracking. The frontend uses plain HTML, CSS, and JavaScript. The API runs on Node.js and persists records in MongoDB.

## Requirements

- Node.js 18 or newer
- MongoDB 7 or newer, running locally or hosted with MongoDB Atlas

## Run locally

1. Start a local MongoDB server, or use MongoDB Atlas.
   With Docker Compose installed, the included configuration starts a persistent local MongoDB service:

   ```sh
   docker compose up -d mongodb
   ```

2. Install the project packages:

   ```sh
   npm install
   ```

3. In the project root (the same folder as `server.js`), copy `.env.example` to `.env` and set `MONGODB_URI`. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Then edit the `MONGODB_URI` line in `.env`. For a local database the default is `mongodb://127.0.0.1:27017/ironhouse`. For Atlas, use the URI from Atlas → **Connect** → **Drivers**. Keep the URI on one line and URL-encode special characters in the database username/password. In Atlas, also add your current IP address under **Network Access**.

4. Start the app:

   ```sh
   npm start
   ```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The app creates sample members, attendance, payments, coaches, and class sessions the first time it connects to an empty database. Existing `data/gym.json` member, attendance, and payment data is imported into MongoDB automatically when the MongoDB database has no members. The source JSON is left untouched.

For development with automatic server restarts, run `npm run dev`. Set `PORT` to change the HTTP port. Never commit `.env` or put a MongoDB connection string in frontend code.

The app loads `.env` from the folder containing `server.js`, even if it is started with a different working directory. Startup reports the MongoDB host and connection hints without printing URI credentials. If startup reports `local default`, it did not find a `MONGODB_URI` in the project-root `.env` or process environment.

## Features

- At-a-glance gym dashboard with membership, monthly revenue, attendance, and today's class metrics
- Searchable and filterable member directory; add and edit member profiles
- Membership expiry tracking and renewals through recorded payments
- Attendance check-in with server-enforced active-membership and once-per-day rules
- Weekly class timetable, coach directory, and new-class scheduling
- Class bookings for active members, duplicate-booking protection, capacity limits, and booking cancellation
- Persistent MongoDB models and indexes for members, attendance, payments, trainers, classes, and bookings
- Responsive desktop and mobile layouts

## Pages

Each workspace area is a separate webpage with its own URL; navigation loads a new document instead of switching hidden sections inside a single page:

- `/dashboard`
- `/members`
- `/classes`
- `/trainers`
- `/attendance`
- `/payments`

The root URL `/` opens the dashboard.

Membership plans are priced in GBP: Basic £29, Standard £49, and Premium £79. Recording a payment renews the selected member for 30 days from the current expiry date, or from today if their membership has expired.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check app and database availability |
| `GET` | `/api/dashboard` | Membership, attendance, revenue, and class metrics |
| `GET`, `POST` | `/api/members` | List/search/filter and create members |
| `PATCH`, `DELETE` | `/api/members/:id` | Update or delete a member |
| `GET`, `POST` | `/api/attendance` | List and record check-ins |
| `GET`, `POST` | `/api/payments` | List and record membership payments |
| `GET` | `/api/trainers` | List coach profiles |
| `GET`, `POST` | `/api/classes` | Browse upcoming sessions and schedule a class |
| `POST` | `/api/classes/:id/bookings` | Reserve a spot for an active member |
| `DELETE` | `/api/bookings/:id` | Cancel a booking and reopen its spot |

Class queries accept `from=YYYY-MM-DD` and `days=1..14`. Member queries accept `search` and `status=active|expired`.

## Tests

Run `npm test` for API integration tests against a temporary MongoDB instance. The first run downloads the MongoDB test binary. `npm run check` verifies JavaScript syntax.

## Before production

This is an operations starter, not a production-ready deployment. Add staff authentication and role-based access, secure MongoDB credentials and network rules, HTTPS, backups, audit logging, and privacy/compliance controls before handling real member data. The seeded trainer profiles and emails are illustrative.
