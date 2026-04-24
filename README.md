<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/bundled/gemini_slingshot

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Input Modes

- `Controller` mode (default):
  - Move aim cursor with thumbstick.
  - Hold trigger (or grip) to pull slingshot.
  - Release trigger to shoot.
  - Change ammo color with shoulder/face buttons.
- `Gesture` mode:
  - Uses webcam + MediaPipe hand pinch tracking.

If the browser supports WebXR, use `Enter XR` in the in-game HUD to start an immersive Quest session.

## AI Provider Architecture

- Frontend now calls `/api/strategic-hint`.
- API keys are read on the server (Cloudflare Pages Functions), not from browser code.
- Supported providers:
  - `gemini`
  - `openai`
  - `anthropic`
- You can switch provider and optional model override in the in-game panel.

## Cloudflare Pages Deploy (Recommended)

1. Create local Git repo and first commit:
   - `git init`
   - `git add .`
   - `git commit -m "feat: quest controller + multi-provider ai backend"`
2. Create remote repo on GitHub and push:
   - `git branch -M main`
   - `git remote add origin <your-repo-url>`
   - `git push -u origin main`
3. In Cloudflare Pages:
   - Connect your GitHub repo.
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Configure Pages Environment Variables / Secrets:
   - `DEFAULT_AI_PROVIDER=gemini` (or `openai` / `anthropic`)
   - `GEMINI_API_KEY=...`
   - `GEMINI_MODEL=gemini-1.5-flash` (optional)
   - `OPENAI_API_KEY=...`
   - `OPENAI_MODEL=gpt-4.1-mini` (optional)
   - `ANTHROPIC_API_KEY=...`
   - `ANTHROPIC_MODEL=claude-3-5-sonnet-latest` (optional)
5. Add custom domain in Pages > Custom domains, then update your DNS records in Cloudflare.

## Notes

- If a provider key is missing, API returns fallback strategy instead of crashing gameplay.
- Keep all model keys only in Cloudflare Secrets. Do not inject keys into Vite frontend env.
