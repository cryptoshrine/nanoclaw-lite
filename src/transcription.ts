/**
 * Voice message transcription using OpenAI Whisper API.
 *
 * Downloads Telegram voice messages and transcribes them via Whisper.
 * Falls back to a placeholder when the API key is not set or transcription fails.
 */

import fs from 'fs';
import path from 'path';
import type { Bot, Context } from 'grammy';
import type { Voice } from 'grammy/types';

import { logger } from './logger.js';

const FALLBACK = '[Voice Message - transcription unavailable]';

/**
 * Download a file from Telegram using grammy's getFile + HTTPS fetch.
 */
async function downloadTelegramFile(bot: Bot<Context>, fileId: string, destDir: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  const filePath = file.file_path;
  if (!filePath) throw new Error('Telegram returned no file_path');

  const token = bot.token;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const destPath = path.join(destDir, path.basename(filePath));

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

/**
 * Transcribe a Telegram voice message using OpenAI Whisper.
 *
 * @param bot - grammy Bot instance (for downloading the file).
 * @param voice - The voice message metadata from Telegram.
 * @returns Transcribed text, or a fallback string on failure.
 */
export async function transcribeVoiceMessage(
  bot: Bot<Context>,
  voice: Voice,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — cannot transcribe voice message');
    return FALLBACK;
  }

  logger.info({ fileId: voice.file_id, duration: voice.duration }, 'Starting voice transcription');

  let tempPath = '';
  try {
    const tmpDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '/tmp',
      '.nanoclaw-tmp',
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    logger.info({ tmpDir }, 'Downloading voice file from Telegram');
    tempPath = await downloadTelegramFile(bot, voice.file_id, tmpDir);
    const fileSize = fs.statSync(tempPath).size;
    logger.info(
      { fileId: voice.file_id, duration: voice.duration, bytes: fileSize, tempPath },
      'Downloaded voice message',
    );

    // Send to OpenAI Whisper API via multipart form upload
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(tempPath);
    const blob = new Blob([fileBuffer], { type: 'audio/ogg' });
    formData.append('file', blob, 'voice.ogg');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    logger.info({ bytes: fileBuffer.length }, 'Sending to Whisper API');
    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText },
        'Whisper API request failed',
      );
      return FALLBACK;
    }

    const transcript = (await response.text()).trim();
    logger.info(
      { duration: voice.duration, chars: transcript.length },
      'Voice message transcribed',
    );
    return transcript;
  } catch (err) {
    logger.error({ err, step: 'transcription', fileId: voice.file_id }, 'Voice transcription failed');
    return FALLBACK;
  } finally {
    // Clean up temp file
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
