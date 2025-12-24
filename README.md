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
- **NEW:** Words flow and fade using p5.js visualization
- Words cascade downward with varying speeds
- Recent words are larger and more visible, older words fade out
- Clean black text on white background
- Console logging for debugging

## Customization

Edit `prompts.txt` to change the cycling prompts. Each line becomes a continuation point for the infinite generation.

## Architecture

Simple, portable code structure:
- `index.html` - Minimal container for p5.js canvas
- `app.js` - p5.js visualization + Ollama generation logic
- `prompts.txt` - Cycling prompt list

## p5.js Features

Now that the engine uses p5.js, you can extend it with:
- Custom word animations and particle effects
- Color gradients and visual themes
- Interactive controls (mouse/keyboard)
- Generative art patterns with the text
- Sound reactivity
- Export frames or recordings
