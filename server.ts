import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { readFileSync, existsSync } from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load Knowledge Base
const kbFilePath = path.resolve(__dirname, 'src', 'tokyo_23_wards_sorting_kb.md');
const KNOWLEDGE_BASE = readFileSync(
  existsSync(kbFilePath) ? kbFilePath : path.resolve('src/tokyo_23_wards_sorting_kb.md'),
  'utf8'
);

// Load System Instruction v3
const sysInstructionPath = path.resolve(__dirname, 'src', 'system_instruction_v3.md');
const SYSTEM_INSTRUCTION_V3 = readFileSync(
  existsSync(sysInstructionPath) ? sysInstructionPath : path.resolve('src/system_instruction_v3.md'),
  'utf8'
);

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

export interface SortingResultPart {
  part: string;
  category:
    | 'burnable'
    | 'non_burnable'
    | 'resource_paper'
    | 'resource_bottles_cans'
    | 'resource_pet'
    | 'plastic'
    | 'oversized'
    | 'drop_off'
    | 'not_collected'
    | 'unknown';
  category_ja: string;
  prep_steps: string[];
  kb_reference: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SortingResult {
  item_name: string;
  materials: string[];
  parts: SortingResultPart[];
  warnings: string[];
  not_in_kb: boolean;
  follow_up_question: string | null;
}

const sortingResponseSchema = {
  type: Type.OBJECT,
  properties: {
    item_name: {
      type: Type.STRING,
      description: 'The identified item name in English',
    },
    materials: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Identified constituent materials (e.g. plastic, metal hook, paper)',
    },
    parts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          part: {
            type: Type.STRING,
            description: 'Component or part name (e.g. bottle body, metal hook, main container)',
          },
          category: {
            type: Type.STRING,
            enum: [
              'burnable',
              'non_burnable',
              'resource_paper',
              'resource_bottles_cans',
              'resource_pet',
              'plastic',
              'oversized',
              'drop_off',
              'not_collected',
              'unknown',
            ],
          },
          category_ja: {
            type: Type.STRING,
            description: 'The Japanese bin name (e.g. 燃やすごみ, 不燃ごみ, 資源プラスチック, 粗大ごみ)',
          },
          prep_steps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Actionable preparation steps before discarding',
          },
          kb_reference: {
            type: Type.STRING,
            description: 'Reference to section in knowledge base (e.g. Part B Type 1, Part D, Part A8)',
          },
          confidence: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
        },
        required: ['part', 'category', 'category_ja', 'prep_steps', 'kb_reference', 'confidence'],
      },
    },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Important warnings or hazards such as battery risks, size thresholds, or danger warnings',
    },
    not_in_kb: {
      type: Type.BOOLEAN,
      description: 'True if the item or ward rule is not covered in the knowledge base',
    },
    follow_up_question: {
      type: Type.STRING,
      nullable: true,
      description: 'A follow-up question if details like item size or detachable parts are unknown, otherwise null',
    },
  },
  required: ['item_name', 'materials', 'parts', 'warnings', 'not_in_kb', 'follow_up_question'],
};

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
      : `Ward: ${wardText}\nPlease identify the item in the image and specify sorting details.`;

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

    let parsedResult: SortingResult | null = null;
    let lastError: any = null;

    // Build system instruction with ward and KB replacements
    const systemInstruction = SYSTEM_INSTRUCTION_V3
      .replaceAll('{ward}', wardText)
      .replaceAll('{KNOWLEDGE_BASE}', KNOWLEDGE_BASE);

    const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];

    for (const model of models) {
      try {
        const config: Record<string, any> = {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: sortingResponseSchema,
        };

        if (model === 'gemini-3.8-flash') {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        }

        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });

        const rawText = response.text?.trim();
        if (rawText) {
          try {
            parsedResult = JSON.parse(rawText) as SortingResult;
            break;
          } catch (parseErr) {
            console.warn(`Failed to parse JSON output from ${model}:`, parseErr, rawText);
          }
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${model} request failed:`, err?.message || err);
      }
    }

    if (parsedResult) {
      return res.json({ result: parsedResult });
    }

    throw lastError || new Error('No valid sorting analysis received.');
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
  console.log(`GOMILENZ server listening on http://0.0.0.0:${PORT}`);
});
