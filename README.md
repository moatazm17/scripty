# Scripty Backend API

## 🚀 Deploy to Railway

### 1. Push to GitHub
```bash
cd /Users/khaled/Desktop/scripty_app/backend
git init
git add .
git commit -m "Initial commit"
gh repo create scripty-backend --private --push
```

### 2. Connect to Railway
1. Go to https://railway.app/dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose "scripty-backend"

### 3. Add Environment Variables
In Railway Dashboard → Variables:

```
PERPLEXITY_API_KEY=your_perplexity_api_key
CLAUDE_API_KEY=your_claude_api_key
PORT=3000
```

### 4. Deploy
Railway will auto-deploy when you push!

---

## 📡 API Endpoints

### GET /
Health check

### GET /api/config
Get available styles, languages, durations

### POST /api/generate
Generate full script

```json
{
  "topic": "موضوع الفيديو",
  "language": "egyptian",
  "duration": "60",
  "style": "mrbeast",
  "selectedHook": null
}
```

### POST /api/hooks
Generate hooks only

```json
{
  "topic": "موضوع الفيديو",
  "style": "mrbeast",
  "language": "egyptian"
}
```

---

## 🔑 API Keys

Get your API keys from:
- **Perplexity:** https://www.perplexity.ai/settings/api
- **Claude:** https://console.anthropic.com/settings/keys
