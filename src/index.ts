import { Client, Events, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '$';
const BALANCE_FILE = path.join(__dirname, 'balances.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');
const INVENTORY_FILE = path.join(__dirname, 'inventories.json');

let inventories: Record<string, Record<string, number>> = {};

if (fs.existsSync(INVENTORY_FILE)) {
  try {
    inventories = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf-8'));
  } catch {
    inventories = {};
  }
}

const saveInventories = () => {
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inventories, null, 2));
};

const shopItems2 = [
  { name: 'Custom Channel', price: 50000000 },
  { name: 'Custom Role', price: 10000000 },
  { name: 'Custom Emoji', price: 5000000 },
];


let balances: Record<string, number> = {};
let cooldowns: Record<string, { daily?: number; weekly?: number; beg?: number; slots?: number; coinflip?: number }> = {};

if (fs.existsSync(BALANCE_FILE)) {
  try {
    balances = JSON.parse(fs.readFileSync(BALANCE_FILE, 'utf-8'));
  } catch {
    balances = {};
  }
}

if (fs.existsSync(COOLDOWN_FILE)) {
  try {
    cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf-8'));
  } catch {
    cooldowns = {};
  }
}

const saveBalances = () => {
  fs.writeFileSync(BALANCE_FILE, JSON.stringify(balances, null, 2));
};

const saveCooldowns = () => {
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
};

const shopItems = [
  { name: 'Bronze Badge', price: 1000 },
  { name: 'Silver Sword', price: 5000 },
  { name: 'Golden Crown', price: 10000 },
];

const slotEmojis = ['🍒', '🍋', '🍇', '🍊', '💎', '7️⃣'];

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user?.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const userId = message.author.id;

  // BALANCE
  if (content.startsWith(`${PREFIX}balance`)) {
    const mentionedUser = message.mentions.users.first();
    const targetUser = mentionedUser ?? message.author;
    const targetId = targetUser.id;

    const balance = balances[targetId] ?? 0;
    return message.reply(`💰 ${targetUser.username} has **${balance}** coins.`);
  }

  // ADDMONEY / REMOVEMONEY
  if (content.startsWith(`${PREFIX}addmoney`) || content.startsWith(`${PREFIX}removemoney`)) {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You do not have permission to use this command.');
    }

    const parts = content.split(' ');
    const mentionedUser = message.mentions.users.first();
    const amount = Number(parts[2]);
    const isAdd = content.startsWith(`${PREFIX}addmoney`);

    if (!mentionedUser || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${PREFIX}${isAdd ? 'addmoney' : 'removemoney'} @user <amount>\``);
    }

    const targetId = mentionedUser.id;
    balances[targetId] = balances[targetId] ?? 0;

    if (isAdd) {
      balances[targetId] += amount;
    } else {
      balances[targetId] = Math.max(0, balances[targetId] - amount);
    }

    saveBalances();
    return message.reply(`✅ ${isAdd ? 'Added' : 'Removed'} **${amount}** coins ${isAdd ? 'to' : 'from'} ${mentionedUser.username}.`);
  }

  // DAILY
  if (content === `${PREFIX}daily`) {
    const now = Date.now();
    const last = cooldowns[userId]?.daily ?? 0;
    const ms = 24 * 60 * 60 * 1000;
    if (now - last < ms) {
      const remaining = ms - (now - last);
      const h = Math.floor(remaining / (1000 * 60 * 60));
      const m = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      return message.reply(`🕓 Wait **${h}h ${m}m** for daily.`);
    }
    const reward = Math.floor(Math.random() * (50000 - 10000 + 1)) + 10000;
    balances[userId] = (balances[userId] ?? 0) + reward;
    cooldowns[userId] = { ...cooldowns[userId], daily: now };
    saveBalances(); saveCooldowns();
    return message.reply(`🎉 You got **${reward}** coins from daily.`);
  }

  // WEEKLY
  if (content === `${PREFIX}weekly`) {
    const now = Date.now();
    const last = cooldowns[userId]?.weekly ?? 0;
    const ms = 7 * 24 * 60 * 60 * 1000;
    if (now - last < ms) {
      const d = Math.floor((ms - (now - last)) / (1000 * 60 * 60 * 24));
      const h = Math.floor(((ms - (now - last)) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      return message.reply(`🕓 Wait **${d}d ${h}h** for weekly.`);
    }
    const reward = Math.floor(Math.random() * (600000 - 100000 + 1)) + 100000;
    balances[userId] = (balances[userId] ?? 0) + reward;
    cooldowns[userId] = { ...cooldowns[userId], weekly: now };
    saveBalances(); saveCooldowns();
    return message.reply(`💸 You got **${reward}** coins from weekly.`);
  }

  // BEG
  if (content === `${PREFIX}beg`) {
    const now = Date.now();
    const last = cooldowns[userId]?.beg ?? 0;
    const ms = 60 * 60 * 1000;
    if (now - last < ms) {
      const m = Math.floor((ms - (now - last)) / (1000 * 60));
      const s = Math.floor(((ms - (now - last)) % (1000 * 60)) / 1000);
      return message.reply(`🕓 Wait **${m}m ${s}s** to beg again.`);
    }
    const reward = Math.floor(Math.random() * (3000 - 2000 + 1)) + 2000;
    balances[userId] = (balances[userId] ?? 0) + reward;
    cooldowns[userId] = { ...cooldowns[userId], beg: now };
    saveBalances(); saveCooldowns();
    return message.reply(`🤲 Someone gave you **${reward}** coins.`);
  }

  // GIVE
  if (content.startsWith(`${PREFIX}give`)) {
    const parts = content.split(' ');
    const mention = message.mentions.users.first();
    const amount = Number(parts[2]);
    if (!mention || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${PREFIX}give @user <amount>\``);
    }
    if ((balances[userId] ?? 0) < amount) {
      return message.reply(`❌ You don't have enough coins.`);
    }
    if (mention.id === userId) {
      return message.reply(`❌ You can't give coins to yourself.`);
    }
    balances[userId] = (balances[userId] ?? 0) - amount;
    balances[mention.id] = (balances[mention.id] ?? 0) + amount;
    saveBalances();
    return message.reply(`✅ You gave **${amount}** coins to ${mention.username}.`);
  }

  // SLOTS
    const slotEmojis = ['🍒', '🍋', '🍇', '🍊', '💎', '7️⃣'];

    if (content.startsWith(`${PREFIX}slots`)) {
      const now = Date.now();
      const last = cooldowns[userId]?.slots ?? 0;

      if (now - last < 5000) {
        return message.reply(`🕓 Wait before spinning again.`);
      }

      const parts = content.split(' ');
      const bet = Number(parts[1]);

      if (!bet || isNaN(bet) || bet <= 0 || bet > 250000) {
        return message.reply('❌ Bet must be between 1 and 250,000.');
      }

      if ((balances[userId] ?? 0) < bet) {
        return message.reply('❌ You don’t have enough coins.');
      }

      const placeholder = '🔄 | 🔄 | 🔄';
      const sent = await message.reply(`🎰 Spinning...\n${placeholder}`);
      await new Promise(res => setTimeout(res, 1000));

      const spin = () => slotEmojis[Math.floor(Math.random() * slotEmojis.length)];

      const result = [spin(), spin(), spin()];

      let winAmount = 0;
      if (result[0] === result[1] && result[1] === result[2]) {
        winAmount = bet * 3;
      } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
        winAmount = bet * 2;
      } else {
        winAmount = -bet;
      }

      balances[userId] = (balances[userId] ?? 0) + winAmount;
      cooldowns[userId] = { ...cooldowns[userId], slots: now };

      saveBalances();
      saveCooldowns();

      await sent.edit(`🎰 | ${result.join(' | ')} |\n${winAmount > 0 ? `🎉 You won **${winAmount}** coins!` : `💀 You lost **${bet}** coins.`}`);
    }

    // COINFLIP
    if (content.startsWith(`${PREFIX}coinflip`)) {
      const now = Date.now();
      const last = cooldowns[userId]?.coinflip ?? 0;

      if (now - last < 5000) {
        return message.reply(`🕓 Wait a few seconds before flipping again.`);
      }

      const args = content.slice(PREFIX.length + 'coinflip'.length).trim().split(/ +/);
      const amount = Number(args[0]);
      const choice = args[1]?.toLowerCase();

      if (!amount || isNaN(amount) || amount <= 0) {
        return message.reply(`❌ Enter a valid amount to bet.`);
      }

      if (amount > 100000) {
        return message.reply(`❌ The maximum bet is **100,000** coins.`);
      }

      if (!['h', 'heads', 't', 'tails'].includes(choice ?? '')) {
        return message.reply(`❌ Please choose \`heads\` (or \`h\`) or \`tails\` (or \`t\`).`);
      }

      if ((balances[userId] ?? 0) < amount) {
        return message.reply('❌ You don’t have enough coins.');
      }

      const userGuess = ['h', 'heads'].includes(choice ?? '') ? 'heads' : 'tails';
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const win = userGuess === result;

      balances[userId] = (balances[userId] ?? 0) + (win ? amount : -amount);
      cooldowns[userId] = { ...cooldowns[userId], coinflip: now };
      saveBalances(); saveCooldowns();

      return message.reply(`🪙 It landed on **${result}**!\n${win ? `🎉 You won **${amount}** coins!` : `💀 You lost **${amount}** coins.`}`);
    }




  // LEADERBOARD
  if (content === `${PREFIX}eclb`) {
    const sorted = Object.entries(balances)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    let leaderboard = '**🏆 Top 10 Richest Users**\n\n';

    for (let i = 0; i < sorted.length; i++) {
      const [userId, balance] = sorted[i] as [string, number];
      try {
        const user = await client.users.fetch(userId);
        leaderboard += `**${i + 1}.** ${user.username} — 💰 **${balance}** coins\n`;
      } catch {
        leaderboard += `**${i + 1}.** Unknown User — 💰 **${balance}** coins\n`;
      }
    }

    return message.reply(leaderboard);
  }

  // SHOP

    if (content === `${PREFIX}shop`) {
      let shopText = `🛒 **Shop Items:**\n`;
      shopItems2.forEach((item, index) => {
        shopText += `${index + 1}. ${item.name} - ${item.price} coins\n`;
      });
      return message.reply(shopText);
    }





    // Assume message and PREFIX are already defined

    if (content.startsWith(`${PREFIX}buy`)) {
      const parts = content.trim().split(' ');
      const index = Number(parts[1]);

      // Validate input and ensure index is within bounds
      if (!index || index < 1 || index > shopItems2.length) {
        return message.reply(`❌ Invalid item number. Use \`${PREFIX}shop\` to see available items.`);
      }

      const item = shopItems2[index - 1];

      if (!item) {
        return message.reply('❌ That item does not exist.');
      }

      const userBalance = balances[userId] ?? 0;

      if (userBalance < item.price) {
        return message.reply(`❌ You don’t have enough coins to buy **${item.name}**.`);
      }

      // Deduct balance and add to inventory
      balances[userId] = userBalance - item.price;

      if (!inventories[userId]) inventories[userId] = {};
      inventories[userId][item.name] = (inventories[userId][item.name] ?? 0) + 1;

      saveBalances();
      saveInventories();

      return message.reply(`✅ You bought **${item.name}** for **${item.price}** coins.`);
    }



    // INVENTORY
    if (content === `${PREFIX}inventory`) {
      const userInventory = inventories[userId] ?? {};
      const entries = Object.entries(userInventory);

      if (entries.length === 0) {
        return message.reply('🎒 Your inventory is empty.');
      }

      let reply = `🎒 **Your Inventory:**\n`;
      for (const [item, count] of entries) {
        reply += `• ${item} x${count}\n`;
      }

      return message.reply(reply);
    }

    if (content === `${PREFIX}help`) {
      const helpMessage = `
    **📜 Economy Bot Commands**

    💰 **Economy:**
    \`${PREFIX}balance [@user]\` – Check your or someone else's balance
    \`${PREFIX}daily\` – Claim daily coins
    \`${PREFIX}weekly\` – Claim weekly reward
    \`${PREFIX}beg\` – Beg for coins
    \`${PREFIX}give @user <amount>\` – Give coins to another user

    🎰 **Gambling:**
    \`${PREFIX}coinflip <amount> <heads/tails or h/t>\` – Flip a coin and gamble coins
    \`${PREFIX}slots <amount>\` – Spin the slot machine

    🛒 **Shop & Inventory:**
    \`${PREFIX}shop\` – View items available in the shop
    \`${PREFIX}buy <item number>\` – Buy an item from the shop
    \`${PREFIX}inventory\` – See your owned items

    📈 **Leaderboard:**
    \`${PREFIX}eclb\` – View top richest users
      `;

      return message.reply(helpMessage);
    }




});

client.login(process.env.DISCORD_BOT_TOKEN);