# Render Deployment Guide (Full Project)

This project is now configured to run entirely on **Render** (both frontend and backend).

## Step 1: Push to GitHub
Simply push your code. The changes I've made ensure that `config.js` automatically detects whether you are on `localhost` or on Render.

```bash
git add .
git commit -m "Switch to Render-only deployment"
git push origin main
```

## Step 2: Create a Blueprint in Render
Since we have a `render.yaml` file, you can use Render's **Blueprints** feature to set up everything at once:

1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New** > **Blueprint**.
3. Connect your **FrameSync** GitHub repository.
4. Render will read the `render.yaml` file and show you what it's going to create (Web Service + Static Site).
5. Click **Apply**.

## Step 3: Configure Environment Variables
After the deployment starts, go to the **Web Service** (framesync-backend) in your Render dashboard:

1. Click **Environment**.
2. Add/Verify these variables:
   - `DATABASE_URL`: (Should be linked to your Neon DB).
   - `JWT_SECRET`: (Should be generated automatically).
   - `FRONTEND_URL`: Set this to your **Render Static Site URL** (e.g., `https://framesync-frontend.onrender.com`).
3. Click **Save Changes**.

## Step 4: Authorize Google Domains
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Go to **APIs & Services** > **Credentials**.
3. Edit your **OAuth 2.0 Client ID**.
4. Add your **Render Static Site URL** to **Authorized JavaScript origins**.
5. Click **Save**.

---

### Why this is better:
- **Zero manual editing**: You never have to change `config.js` manually before pushing again.
- **Unified Billing/Management**: Everything is in one Render dashboard.
- **Simplified Local Development**: The code naturally falls back to `localhost:3000` when you're working locally.
