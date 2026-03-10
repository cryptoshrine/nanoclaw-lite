/**
 * Create "Klaw Projects" category with channels for shortlisted business ideas
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

    // Create "Klaw Projects" category
    const category = await guild.channels.create({
      name: '🚀 Klaw Projects',
      type: ChannelType.GuildCategory,
    });
    console.log(`Created category: ${category.name} (${category.id})`);

    // Create channels under the category
    const channels = [
      {
        name: 'betting-intelligence',
        topic: 'Betting Intelligence Service — automated value bet reports, Dixon-Coles model, OddsPortal scraping, subscription pricing, legal considerations',
      },
      {
        name: 'info-product-factory',
        topic: 'Info Product Factory — Premier League Intelligence Brief, weekly PDF reports, automated generation via Ball-AI, distribution & monetization',
      },
      {
        name: 'openclaw-football-skills',
        topic: 'OpenClaw Skills for Football — publishing Ball-AI tools as OpenClaw marketplace skills, packaging, pricing, community distribution',
      },
    ];

    const envLines = [`\n# Klaw Projects`, `DISCORD_CHANNEL_KLAW_PROJECTS_CATEGORY=${category.id}`];

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
