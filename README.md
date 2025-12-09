# Word Bag Soul Trap

An infinite text generator art project. Text cycles through prompts, generating continuously in an e-ink optimized display.

## Setup

```bash
npm install
```

Make sure Ollama is running:
```bash
ollama serve
```

Start the dev server:
```bash
npm run dev
```

## How It Works

- Loads prompts from `prompts.txt` (one per line)
- Cycles through prompts automatically
- Each generation appends to the previous text
- Displays in a scrolling window with fade effect at top
- E-ink optimized: black text on white, minimal UI
- Console logging for debugging

## Customization

Edit `prompts.txt` to change the cycling prompts. Each line becomes a continuation point for the infinite generation.

## Architecture

Simple, portable code structure:
- `index.html` - Minimal e-ink optimized UI
- `app.js` - Clean generation logic
- `prompts.txt` - Cycling prompt list
