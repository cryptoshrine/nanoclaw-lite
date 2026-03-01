/**
 * Create "Ideas" category with brainstorming channels on Discord
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

    // Create "Ideas" category
    const category = await guild.channels.create({
      name: '💡 Ideas',
      type: ChannelType.GuildCategory,
    });
    console.log(`Created category: ${category.name} (${category.id})`);

    // Create channels under the category
    const channels = [
      { name: 'pika-tamagotchi-ai-agents', topic: 'Brainstorming: Pika Tamagotchi AI Agents Game — game mechanics, AI agent behaviors, virtual pet concepts, monetization' },
      { name: 'sports-perp-exchange', topic: 'Brainstorming: Sports Perpetual Futures Exchange — trading mechanics, sports markets, pricing models, regulations' },
    ];

    for (const ch of channels) {
      const created = await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: ch.topic,
      });
      console.log(`Created channel: #${created.name} (${created.id})`);
    }

    console.log('\nDone! New channels created successfully.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(KLAW_TOKEN);
