/**
 * Post welcome/seed messages to the new Ideas channels
 */
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

const KLAW_TOKEN = process.env.DISCORD_KLAW_TOKEN;

const CHANNELS = {
  pika: process.env.DISCORD_CHANNEL_PIKA_TAMAGOTCHI,
  perp: process.env.DISCORD_CHANNEL_SPORTS_PERP,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    // Pika Tamagotchi channel
    const pikaChannel = await client.channels.fetch(CHANNELS.pika);
    const pikaEmbed = new EmbedBuilder()
      .setColor(0xfbbf24)
      .setTitle('🎮 Pika Tamagotchi AI Agents')
      .setDescription(
        'Brainstorming space for the AI Agent Tamagotchi game concept.\n\n' +
        '**Key areas to explore:**\n' +
        '• Game mechanics — how do AI agents grow, evolve, compete?\n' +
        '• Agent personalities & behaviors\n' +
        '• Integration with Ball-AI (football-themed agents?)\n' +
        '• Monetization model\n' +
        '• Tech stack & feasibility\n' +
        '• Target audience & distribution\n\n' +
        'Drop ideas, references, sketches — anything goes here.'
      )
      .setFooter({ text: 'Klaw • Ideas Lab' })
      .setTimestamp();
    await pikaChannel.send({ embeds: [pikaEmbed] });
    console.log('Posted to #pika-tamagotchi-ai-agents');

    // Sports Perp channel
    const perpChannel = await client.channels.fetch(CHANNELS.perp);
    const perpEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle('📈 Sports Perpetual Futures Exchange')
      .setDescription(
        'Brainstorming space for the Sports Perp Exchange concept.\n\n' +
        '**Key areas to explore:**\n' +
        '• Market design — what sports metrics get perp contracts?\n' +
        '• Pricing & oracle mechanisms\n' +
        '• Integration with Ball-AI data & analytics\n' +
        '• Regulatory considerations\n' +
        '• Tokenomics & incentive structures\n' +
        '• Competitor landscape\n' +
        '• MVP scope & tech stack\n\n' +
        'Drop ideas, research, market comparisons — anything goes here.'
      )
      .setFooter({ text: 'Klaw • Ideas Lab' })
      .setTimestamp();
    await perpChannel.send({ embeds: [perpEmbed] });
    console.log('Posted to #sports-perp-exchange');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(KLAW_TOKEN);
