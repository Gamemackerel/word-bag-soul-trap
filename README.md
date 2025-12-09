# Word Bag Soul Trap

An infinite text generator art project using Ollama and the tinydolphin model.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Make sure Ollama is running locally:
```bash
ollama serve
```

3. Start the dev server:
```bash
npm run dev
```

4. Open the URL shown in your browser (usually http://localhost:5173)

5. Click GO to start generating. The app will automatically download the tinydolphin model if needed.

## How it works

- Click GO to generate text
- Each generation continues from where the previous one left off
- Creates an infinite stream of AI-generated text
- Uses the small tinydolphin model for fast, local generation
