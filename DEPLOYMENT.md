# FrameSync Deployment Guide

## 🚀 Quick Overview

This guide will help you deploy your FrameSync application:
- **Frontend** → Netlify (static files)
- **Backend** → Render (Node.js server)
- **Database** → Neon PostgreSQL (already configured)

---

## 📋 Prerequisites

1. **GitHub Account** - Your code must be in a GitHub repository
2. **Netlify Account** - Sign up at https://netlify.com (free)
3. **Render Account** - Sign up at https://render.com (free)
4. **Environment Variables** - From your `server/.env` file

---

## 🔧 Step 1: Prepare Your Code

### 1.1 Install CORS Package

```bash
cd server
npm install cors
```

### 1.2 Commit and Push to GitHub

```bash
git add .
git commit -m "Add deployment configuration for Netlify and Render"
git push origin main
```

> **Note**: Make sure your `.env` file is NOT committed (it should be in `.gitignore`)

---

## 🖥️ Step 2: Deploy Backend to Render

### 2.1 Create Render Account
1. Go to https://render.com
2. Click "Get Started" and sign up with GitHub
3. Authorize Render to access your repositories

### 2.2 Create New Web Service
1. Click "New +" button → "Web Service"
2. Connect your GitHub repository
3. Select your FrameSync repository
4. Render will auto-detect the `render.yaml` configuration

### 2.3 Configure Service
- **Name**: `framesync-backend` (or your preferred name)
- **Region**: Choose closest to your users
- **Branch**: `main` (or your default branch)
- **Build Command**: `cd server && npm install`
- **Start Command**: `cd server && npm start`
- **Plan**: Free

### 2.4 Add Environment Variables
Click "Environment" tab and add these variables from your `server/.env`:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Neon PostgreSQL connection string |
| `JWT_SECRET` | Your JWT secret key |
| `EMAIL_USER` | Your Gmail address |
| `EMAIL_PASS` | Your Gmail app password |
| `TMDB_API_KEY` | Your TMDB API key |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | Leave empty for now (add after Netlify deployment) |

### 2.5 Deploy
1. Click "Create Web Service"
2. Wait for deployment to complete (~2-5 minutes)
3. **Copy your backend URL** (e.g., `https://framesync-backend.onrender.com`)

---

## 🌐 Step 3: Deploy Frontend to Netlify

### 3.1 Update netlify.toml
1. Open `netlify.toml` in your project
2. Replace `https://your-app-name.onrender.com` with your actual Render URL
3. Example:
   ```toml
   from = "/api/*"
   to = "https://framesync-backend.onrender.com/api/:splat"
   ```
4. Save and commit:
   ```bash
   git add netlify.toml
   git commit -m "Update backend URL in netlify.toml"
   git push origin main
   ```

### 3.2 Create Netlify Account
1. Go to https://netlify.com
2. Click "Sign up" and connect with GitHub
3. Authorize Netlify to access your repositories

### 3.3 Deploy Site
1. Click "Add new site" → "Import an existing project"
2. Choose "Deploy with GitHub"
3. Select your FrameSync repository
4. Netlify will auto-detect `netlify.toml`
5. Click "Deploy site"

### 3.4 Get Your Site URL
1. After deployment, copy your site URL (e.g., `https://your-site-name.netlify.app`)
2. You can customize this in Site settings → Domain management

---

## 🔄 Step 4: Final Configuration

### 4.1 Update Backend CORS
1. Go back to Render dashboard
2. Open your web service
3. Go to "Environment" tab
4. Add/Update `FRONTEND_URL` with your Netlify URL:
   ```
   FRONTEND_URL=https://your-site-name.netlify.app
   ```
5. Save (this will trigger a redeploy)

### 4.2 Test Your Deployment
1. Visit your Netlify URL
2. Try signing up with a new account
3. Create a room and test video sync
4. Verify Socket.IO connections work

---

## ✅ Verification Checklist

### Backend (Render)
- [ ] Service is running (green status)
- [ ] Logs show "FrameSync Server Running"
- [ ] Database connection successful
- [ ] No CORS errors in logs

### Frontend (Netlify)
- [ ] Site loads correctly
- [ ] No console errors in browser DevTools
- [ ] API calls reach backend (check Network tab)
- [ ] Socket.IO connects (look for WebSocket in Network tab)

### Functionality
- [ ] User signup works (email received)
- [ ] Login works (both email and Google)
- [ ] Room creation works
- [ ] Video sync works (YouTube and file upload)
- [ ] Chat messages work
- [ ] Reactions work
- [ ] Friend system works

---

## 🐛 Troubleshooting

### "Failed to fetch" or CORS errors
- Check that `FRONTEND_URL` is set correctly in Render
- Verify `netlify.toml` has correct backend URL
- Check Render logs for CORS warnings

### Socket.IO connection fails
- Verify `/socket.io/*` redirect in `netlify.toml`
- Check browser console for WebSocket errors
- Ensure Render service is running

### Database connection errors
- Verify `DATABASE_URL` in Render environment variables
- Check Neon database is active
- Review Render logs for connection errors

### Email not sending
- Verify `EMAIL_USER` and `EMAIL_PASS` in Render
- Check Gmail app password is correct (16 digits with spaces)
- Review Render logs for SMTP errors

### Render service sleeping (Free tier)
- Free tier spins down after 15 minutes of inactivity
- First request takes ~30 seconds to wake up
- Consider upgrading to paid plan for production

---

## 🎯 Next Steps

### Custom Domain (Optional)
1. **Netlify**: Site settings → Domain management → Add custom domain
2. **Render**: Service → Settings → Custom domain

### Environment Management
- Use different environment variables for staging/production
- Never commit `.env` files to Git
- Rotate secrets regularly

### Monitoring
- **Render**: Check logs regularly for errors
- **Netlify**: Enable analytics for traffic insights
- **Neon**: Monitor database usage and queries

### Performance
- Consider upgrading Render to paid plan to avoid cold starts
- Enable Netlify CDN for faster global access
- Optimize database queries for better performance

---

## 📞 Support

If you encounter issues:
1. Check Render logs: Dashboard → Your Service → Logs
2. Check Netlify deploy logs: Site → Deploys → Deploy log
3. Check browser console for frontend errors
4. Review this guide's troubleshooting section

---

## 🎉 Success!

Your FrameSync application is now live! Share your Netlify URL with friends and start watching together!

**Frontend**: `https://your-site-name.netlify.app`
**Backend**: `https://framesync-backend.onrender.com`
