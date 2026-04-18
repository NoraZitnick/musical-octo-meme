# musical-octo-meme

A React + Supabase MVP for planning and managing school clubs.

## Folder Structure

- `src/App.jsx` - routes + page logic for auth, dashboard, clubs, events, attendance
- `src/lib/supabase.js` - Supabase client config (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
- `src/styles.css` - app styles and responsive layout
- `supabase/setup.sql` - schema, constraints, RLS policies, helper functions

## Setup

1. Install dependencies:
   - `npm install`
2. Create `.env` in project root:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. In Supabase:
   - Enable Email auth and Google auth provider
   - Run SQL from `supabase/setup.sql` in SQL editor
4. Start app:
   - `npm run dev`

## Routes

- `/` home page with top-right login/sign-up and hero background image
- `/login` login/sign-up page (email/password + Google OAuth)
- `/dashboard` member clubs, admin clubs, new event red-dot, add-club actions
- `/create-club` create club and auto-add creator as admin
- `/join-club` pick school (autocomplete) and join clubs
- `/club/:id` member view with events + attendance controls
- `/club/:id/admin` admin view with event CRUD + member role management

## Security Notes

- Row Level Security is enabled on all app tables in `supabase/setup.sql`.
- Policies enforce user ownership and admin-only mutation for club-level data.
- Frontend only uses anon key; no service-role key is exposed.
- Additional hardening recommendations are included as SQL comments.
