/**
 * Create "Betting Model" category with a working channel for model development
 */
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

const KLAW_TOKEN = process.env.DISCORD_KLAW_TOKEN;
const SERVER_ID = process.env.DISCORD_SERVER_ID;

if (!KLAW_TOKEN || !SERVER_ID) {
  console.error('Missing DISCORD_KLAW_TOKEN or DISCORD_SERVER_ID');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(SERVER_ID);
    console.log(`Connected to server: ${guild.name}`);

    // Create "Betting Model" category
    const category = await guild.channels.create({
      name: '📊 Betting Model',
      type: ChannelType.GuildCategory,
    });
    console.log(`Created category: ${category.name} (${category.id})`);

    // Create channels under the category
    const channels = [
      {
        name: 'model-development',
        topic: 'Betting model development — Dixon-Coles implementation, parameter tuning, backtesting, new market models, performance tracking',
      },
      {
        name: 'value-bets',
        topic: 'Daily value bet outputs — model predictions vs bookmaker odds, edge analysis, bet tracking, P&L reporting',
      },
      {
        name: 'model-logs',
        topic: 'Automated model run logs — scraping results, model updates, error tracking, pipeline health',
      },
    ];

    const envLines = [`\n# Betting Model`, `DISCORD_CHANNEL_BETTING_MODEL_CATEGORY=${category.id}`];

    for (const ch of channels) {
      const created = await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: ch.topic,
      });
      console.log(`Created channel: #${created.name} (${created.id})`);
      const envKey = `DISCORD_CHANNEL_${ch.name.toUpperCase().replace(/-/g, '_')}`;
      envLines.push(`${envKey}=${created.id}`);
    }

    console.log('\nDone! Add these to your .env:\n');
    console.log(envLines.join('\n'));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(KLAW_TOKEN);
