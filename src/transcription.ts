/**
 * Voice message transcription using OpenAI Whisper API.
 *
 * Downloads Telegram voice messages and transcribes them via Whisper.
 * Falls back to a placeholder when the API key is not set or transcription fails.
 */

import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';

import { logger } from './logger.js';

const FALLBACK = '[Voice Message - transcription unavailable]';

/**
 * Transcribe a Telegram voice message using OpenAI Whisper.
 *
 * @param bot - Telegram bot instance (for downloading the file).
 * @param voice - The voice message metadata from Telegram.
 * @returns Transcribed text, or a fallback string on failure.
 */
export async function transcribeVoiceMessage(
  bot: TelegramBot,
  voice: TelegramBot.Voice,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — cannot transcribe voice message');
    return FALLBACK;
  }

  let tempPath = '';
  try {
    // Download the voice file from Telegram to a temp directory
    const tmpDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '/tmp',
      '.nanoclaw-tmp',
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    tempPath = await bot.downloadFile(voice.file_id, tmpDir);
    const fileSize = fs.statSync(tempPath).size;
    logger.info(
      { fileId: voice.file_id, duration: voice.duration, bytes: fileSize },
      'Downloaded voice message',
    );

    // Send to OpenAI Whisper API via multipart form upload
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(tempPath);
    const blob = new Blob([fileBuffer], { type: 'audio/ogg' });
    formData.append('file', blob, 'voice.ogg');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

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
    logger.error({ err }, 'Voice transcription failed');
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
