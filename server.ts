import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Allow large image uploads (base64 downscaled images)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface ImagePayload {
  base64: string;
  mimeType: string;
}

app.post('/api/sort', async (req, res) => {
  try {
    const { item, ward, image } = req.body as { item?: string; ward?: string; image?: ImagePayload };

    const hasItem = typeof item === 'string' && item.trim().length > 0;
    const hasImage = Boolean(image && image.base64 && typeof image.base64 === 'string');

    if (!hasItem && !hasImage) {
      return res.status(400).json({ error: 'Please type an item name or upload a photo to check.' });
    }

    const itemText = hasItem ? (item as string).trim() : '';
    const wardText = ward && typeof ward === 'string' && ward.trim() ? ward.trim() : 'Tokyo';

    const textPrompt = itemText
      ? `Ward: ${wardText}\nItem description: ${itemText}\nPlease identify and sort this item.`
      : `Ward: ${wardText}\nPlease identify the item in the image and tell the user which bin it goes in according to Tokyo garbage sorting rules.`;

    const contents = hasImage && image
      ? {
          parts: [
            {
              inlineData: {
                mimeType: image.mimeType || 'image/jpeg',
                data: image.base64,
              },
            },
            { text: textPrompt },
          ],
        }
      : textPrompt;

    let reply = '';
    let lastError: any = null;

    const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

    for (const model of models) {
      try {
        const config: Record<string, any> = {
          systemInstruction: 'You are a garbage sorting assistant for Tokyo. Tell the user which bin the item goes in.',
        };

        if (model === 'gemini-3.8-flash') {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        }

        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });

        if (response && response.text) {
          reply = response.text.trim();
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${model} request failed:`, err?.message || err);
      }
    }

    if (reply) {
      return res.json({ reply });
    }

    throw lastError || new Error('No response generated.');
  } catch (error: any) {
    console.error('Gemini sorting error:', error);
    let message = 'Unable to check sorting rules at this moment. Please try again.';

    if (error?.message) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed?.error?.message) {
          message = parsed.error.message;
        } else {
          message = error.message;
        }
      } catch {
        message = error.message;
      }
    }

    return res.status(500).json({ error: message });
  }
});

// Vite middlewares for dev, static dist for production
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GOMIRENZ server listening on http://0.0.0.0:${PORT}`);
});
