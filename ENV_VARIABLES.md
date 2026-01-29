# Environment Variables for Render

Copy these values from your local `server/.env` file to Render's Environment settings.

## Required Variables

### Database
```
DATABASE_URL=postgresql://neondb_owner:npg_EsFv8gUoT4fm@ep-summer-frog-ahput38k-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

### Authentication
```
JWT_SECRET=framesync-super-secret-key-2025
```

### Email (Gmail SMTP)
```
EMAIL_USER=hmanagha07@gmail.com
EMAIL_PASS=hycs otie qoyc gfir
```

### External APIs
```
TMDB_API_KEY=585c8db9ec956b0d0598337137a3fc35
```

### Production Settings
```
NODE_ENV=production
FRONTEND_URL=https://your-site-name.netlify.app
```

## How to Add in Render

1. Go to your Render dashboard
2. Select your web service
3. Click "Environment" in the left sidebar
4. Click "Add Environment Variable"
5. Enter the key and value
6. Click "Save Changes" (this will trigger a redeploy)

## Security Notes

⚠️ **IMPORTANT**: 
- Never commit this file to Git
- This file is for reference only during deployment
- After deployment, delete this file or keep it secure
- Consider rotating secrets after initial deployment
