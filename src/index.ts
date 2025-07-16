import { Client, Events, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Collection, Invite } from 'discord.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const PREFIX = '$';
const BALANCE_FILE = path.join(__dirname, 'balances.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');
const INVENTORY_FILE = path.join(__dirname, 'inventories.json');
const invites = new Map<string, Collection<string, Invite>>();
const inviteCooldowns: Record<string, number> = {};
const CLAN_FILE = path.join(__dirname, 'clans.json');

// Make sure the file exists before loading
if (!fs.existsSync(CLAN_FILE)) {
  fs.writeFileSync(CLAN_FILE, '{}');
}

// Load clans safely
let clans: Record<string, {
  name: string;                             // Display name of the clan
  tag: string;                              // Stylized tag, e.g., ᶜʰᵃᵒˢ (used for nickname)
  owner: string;                            // User ID of the clan owner
  coLeaders: string[];                      // User IDs of co-leaders
  elders: string[];                         // User IDs of elders
  members: string[];                        // User IDs of normal members
  private: boolean;                         // Whether the clan is private or public
  vault: number;                            // Total coins in the clan vault
  goal: number;                             // Goal amount to level up
  level: number;                            // Clan level
  contributions: Record<string, number>;    // User ID to amount contributed
  createdAt: number;                        // Timestamp when the clan was created
  description?: string;                     // Optional clan description
  icon?: string;                            // Optional emoji/icon string like "⚔️"
}>;

async function setClanNickname(member: GuildMember, clanTag: string | null) {
  const baseName = member.displayName.replace(/ᶜʰᵃᵒˢ|ᵈᵉᵛ|ᵖʳᵒ|ᶜˡᵃⁿ/gi, ''); // remove old tags if any
  const newNick = clanTag ? `${baseName}${clanTag}` : baseName;

  try {
    await member.setNickname(newNick);
  } catch (err) {
    console.error(`Failed to set nickname for ${member.user.username}:`, err);
  }
}


try {
  const raw = fs.readFileSync(CLAN_FILE, 'utf-8');
  clans = raw.trim() ? JSON.parse(raw) : {};
} catch {
  clans = {};
}

// Save function
const saveClans = () => {
  fs.writeFileSync(CLAN_FILE, JSON.stringify(clans, null, 2));
};


const PENDING_FILE = path.join(__dirname, 'pendingInvites.json');
let pendingInvites: Record<string, { inviterId: string; joinedAt: number }> = fs.existsSync(PENDING_FILE)
  ? JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8'))
  : {};

const savePendingInvites = () => {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingInvites, null, 2));
};


client.on(Events.GuildMemberAdd, async (member) => {
  const cachedInvites = invites.get(member.guild.id);
  const newInvites = await member.guild.invites.fetch().catch(() => null);
  if (!cachedInvites || !newInvites) return;

  const invite = newInvites.find(i => {
    const old = cachedInvites.get(i.code);
    const invite = newInvites.find(i => {
      const old = cachedInvites.get(i.code);
      return old && typeof i.uses === 'number' && typeof old.uses === 'number' && i.uses > old.uses;
    });
  });

  invites.set(member.guild.id, newInvites);

  if (!invite || !invite.inviter) return;

  pendingInvites[member.id] = {
    inviterId: invite.inviter.id,
    joinedAt: Date.now(),
  };

  savePendingInvites();
});

client.on(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);

  // Load initial invites
  for (const [id, guild] of client.guilds.cache) {
    const inviteList = await guild.invites.fetch().catch(() => null);
    if (inviteList) invites.set(guild.id, inviteList);
  }

  // Check for 2-day old members
  const now = Date.now();
  const twoDays = 2 * 24 * 60 * 60 * 1000;

  for (const [memberId, data] of Object.entries(pendingInvites)) {
    const { inviterId, joinedAt } = data;

    if (now - joinedAt >= twoDays) {
      try {
        const guild = client.guilds.cache.find(g => g.members.cache.has(memberId));
        const member = guild?.members.cache.get(memberId) ?? await guild?.members.fetch(memberId);
        if (!member) {
          // If member already left, don't reward
          delete pendingInvites[memberId];
          savePendingInvites();
          continue;
        }

        const reward = Math.floor(Math.random() * (50000 - 25000 + 1)) + 25000;
        balances[inviterId] = (balances[inviterId] ?? 0) + reward;
        saveBalances();

        const inviterUser = await client.users.fetch(inviterId);
        await inviterUser.send(`🎉 You earned **${reward}** coins for inviting **${member.user.tag}** (stayed 2+ days).`);

        delete pendingInvites[memberId];
        savePendingInvites();
      } catch {
        // skip if error
      }
    }
  }
});




client.on('ready', async () => {
  for (const [guildId, guild] of client.guilds.cache) {
    const inviteList = await guild.invites.fetch();
    invites.set(guildId, inviteList);
  }
  console.log('✅ Invite tracking ready.');
});
client.on('guildMemberAdd', async (member) => {
  const guild = member.guild;
  const oldInvites = invites.get(guild.id);
  const newInvites = await guild.invites.fetch();

  invites.set(guild.id, newInvites);

  const invite = newInvites.find(i => {
    const old = oldInvites?.get(i.code);
    return old && typeof i.uses === 'number' && typeof old.uses === 'number' && i.uses > old.uses;
  });

  if (!invite || !invite.inviter) return;

  const inviterId = invite.inviter.id;
  const now = Date.now();
  const lastUsed = inviteCooldowns[inviterId] ?? 0;

  if (now - lastUsed < 60 * 1000) return; // 1 minute cooldown

  const reward = Math.floor(Math.random() * (50000 - 25000 + 1)) + 25000;
  balances[inviterId] = (balances[inviterId] ?? 0) + reward;
  inviteCooldowns[inviterId] = now;
  saveBalances();

  try {
    const user = await client.users.fetch(inviterId);
    user.send(`🎁 You earned **${reward}** coins for inviting someone!`);
  } catch (err) {
    console.error(`Could not DM user ${inviterId}:`, err);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const cachedInvites = invites.get(member.guild.id);
  const newInvites = await member.guild.invites.fetch().catch(() => null);
  if (!cachedInvites || !newInvites) return;

  const invite = newInvites.find(i => {
    const old = cachedInvites.get(i.code);
    return old && typeof i.uses === 'number' && typeof old.uses === 'number' && i.uses > old.uses;
  });

  invites.set(member.guild.id, newInvites);

  if (!invite || !invite.inviter) return;

  const inviterId = invite.inviter.id;
  const now = Date.now();
  const cooldown = 60 * 1000; // 1 minute

  if (inviteCooldowns[inviterId] && now - inviteCooldowns[inviterId] < cooldown) return;

  const reward = Math.floor(Math.random() * (50000 - 25000 + 1)) + 25000;
  balances[inviterId] = (balances[inviterId] ?? 0) + reward;
  inviteCooldowns[inviterId] = now;
  saveBalances();

  try {
    const inviterUser = await member.client.users.fetch(inviterId);
    inviterUser.send(`🎉 You earned **${reward}** coins for inviting **${member.user.tag}** to the server!`);
  } catch (err) {
    console.warn(`Couldn't DM ${inviterId}`);
  }
});



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
  if (content.startsWith(`${PREFIX}balance`) || content.startsWith(`${PREFIX}bal`)) {
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

  let result: string[];

  const outcome = Math.random();

  if (outcome < 1 / 3) {
    // Triple match
    const emoji = spin();
    result = [emoji, emoji, emoji];
  } else if (outcome < 2 / 3) {
    // Double match
    const emoji1 = spin();
    let emoji2 = spin();
    while (emoji2 === emoji1) emoji2 = spin(); // make sure it's different for the 3rd
    const matchType = Math.floor(Math.random() * 3);
    if (matchType === 0) result = [emoji1, emoji1, emoji2];
    else if (matchType === 1) result = [emoji2, emoji1, emoji1];
    else result = [emoji1, emoji2, emoji1];
  } else {
    // No match
    do {
      result = [spin(), spin(), spin()];
    } while (
      result[0] === result[1] ||
      result[1] === result[2] ||
      result[0] === result[2]
    );
  }

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
if (content.startsWith(`${PREFIX}coinflip`) || content.startsWith(`${PREFIX}cf`)) {
  const now = Date.now();
  const last = cooldowns[userId]?.coinflip ?? 0;

  if (now - last < 5000) {
    return message.reply(`🕓 Wait a few seconds before flipping again.`);
  }

  const args = content.slice(PREFIX.length + (content.startsWith(`${PREFIX}cf`) ? 'cf'.length : 'coinflip'.length)).trim().split(/ +/);
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

  // Biased win system: 70% chance the user wins
  const win = Math.random() < 0.7;
  const result = win ? userGuess : (userGuess === 'heads' ? 'tails' : 'heads');

  balances[userId] = (balances[userId] ?? 0) + (win ? amount : -amount);
  cooldowns[userId] = { ...cooldowns[userId], coinflip: now };
  saveBalances();
  saveCooldowns();

  return message.reply(`🪙 It landed on **${result}**!\n${win ? `🎉 You won **${amount}** coins!` : `💀 You lost **${amount}** coins.`}`);
}






  // LEADERBOARD
  if (
  content === `${PREFIX}eclb` ||
  content === `${PREFIX}economyleaderboard` ||
  content === `${PREFIX}economylb`
) {
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

    //CLAN CXREATE
    if (content.startsWith(`${PREFIX}clan create`)) {
      const parts = content.split(" ");
      const clanName = parts.slice(2).join(" ").trim();

      if (!clanName) return message.reply("❌ Please provide a name for your clan.");
      if (clans[clanName]) return message.reply("❌ A clan with this name already exists.");

      // Check if user already owns or is in a clan
      const inClan = Object.values(clans).some(
        (clan) =>
          clan.owner === userId ||
          clan.coLeaders.includes(userId) ||
          clan.elders.includes(userId) ||
          clan.members.includes(userId)
      );
      if (inClan) return message.reply("❌ You are already in a clan.");

      clans[clanName] = {
        name: clanName,
        owner: userId,
        coLeaders: [],
        elders: [],
        members: [],
        private: true, // default
        vault: 0,
        goal: 10_000_000,
        level: 1,
        contributions: {}
      };

      saveClans();
      return message.reply(`✅ Clan **${clanName}** has been created and is private by default.`);
    }


    //CLAN PUBLIC/PRIVATE
    if (content === `${PREFIX}clan public`) {
      const userClan = Object.values(clans).find(clan => clan.owner === userId);

      if (!userClan) {
        return message.reply('❌ You don’t own a clan.');
      }

      if (!userClan.private) {
        return message.reply('⚠️ Your clan is already public.');
      }

      userClan.private = false;
      saveClans();
      return message.reply(`🌐 Your clan **${userClan.name}** is now **public** and can be joined by others.`);
    }


    if (content === `${PREFIX}clan private`) {
      const userClan = Object.values(clans).find(clan => clan.owner === userId);

      if (!userClan) {
        return message.reply('❌ You don’t own a clan.');
      }

      if (userClan.private) {
        return message.reply('⚠️ Your clan is already private.');
      }

      userClan.private = true;
      saveClans();
      return message.reply(`🔒 Your clan **${userClan.name}** is now **private** and cannot be joined by others.`);
    }

    //CLAN JOIN

    if (content.startsWith(`${PREFIX}clan join`)) {
  const args = content.split(' ');
  const clanName = args.slice(2).join(' ').trim();

  if (!clanName) {
    return message.reply('❌ Please provide the name of the clan you want to join.\nUsage: `$clan join <clan name>`');
  }

  // Find clan by name (case-insensitive)
  const targetClanEntry = Object.entries(clans).find(
    ([, clan]) => clan.name.toLowerCase() === clanName.toLowerCase()
  );

  if (!targetClanEntry) {
    return message.reply(`❌ No clan found with the name **${clanName}**.`);
  }

  const [clanKey, clan] = targetClanEntry;

  // Check if the clan is private
  if (clan.private) {
    return message.reply(`🔒 **${clan.name}** is a private clan and cannot be joined without an invite.`);
  }

  // Check if user is already in a clan
  const existingClan = Object.values(clans).find(c =>
    [c.owner, ...c.coLeaders, ...c.elders, ...c.members].includes(userId)
  );

  if (existingClan) {
    return message.reply('❌ You are already in a clan. Leave your current clan before joining another.');
  }

  // Add user to members list
  clan.members.push(userId);
  saveClans();

  // Update user's nickname with clan tag
  const member = message.guild.members.cache.get(userId);
  if (member) {
    try {
      await setClanNickname(member, clan.tag);
    } catch (err) {
      console.error(`Failed to set nickname for user ${userId}:`, err);
    }
  }

  return message.reply(`✅ You have successfully joined the clan **${clan.name}**!`);
}


    //CLAN INVITE

    if (content.startsWith(`${PREFIX}clan invite`)) {
  const mentionedUser = message.mentions.users.first();
  const inviterId = message.author.id;

  if (!mentionedUser) {
    return message.reply(`❌ Please mention a user to invite.\nUsage: \`${PREFIX}clan invite @user\``);
  }

  const userToInviteId = mentionedUser.id;

  const inviterClanEntry = Object.entries(clans).find(
    ([, c]) => c.owner === inviterId
  );

  if (!inviterClanEntry) {
    return message.reply('❌ You are not a clan owner. Only owners can invite users to private clans.');
  }

  const [clanKey, clan] = inviterClanEntry;

  if (!clan.private) {
    return message.reply('❌ This command is only used for private clans.');
  }

  const alreadyInClan = Object.values(clans).some(c =>
    [c.owner, ...c.coLeaders, ...c.elders, ...c.members].includes(userToInviteId)
  );

  if (alreadyInClan) {
    return message.reply(`❌ ${mentionedUser.username} is already in a clan.`);
  }

  const inviteMsg = await message.channel.send({
    content: `📩 <@${userToInviteId}>, you have been invited to join the clan **${clan.name}** by <@${inviterId}>!\nReact with ☑️ to accept or ❌ to decline.`,
  });

  await inviteMsg.react('☑️');
  await inviteMsg.react('❌');

  const filter = (reaction: MessageReaction, user: User) =>
    ['☑️', '❌'].includes(reaction.emoji.name ?? '') && user.id === userToInviteId;

  const collector = inviteMsg.createReactionCollector({ filter, max: 1, time: 2 * 60 * 1000 });

  collector.on('collect', async (reaction, user) => {
    if (reaction.emoji.name === '☑️') {
      clan.members.push(userToInviteId);
      saveClans();

      const member = message.guild.members.cache.get(userToInviteId);
      if (member) {
        try {
          await setClanNickname(member, clan.tag);
        } catch (err) {
          console.error(`Failed to set nickname for ${member.user.tag}:`, err);
        }
      }

      await inviteMsg.reply(`✅ <@${userToInviteId}> has joined the clan **${clan.name}**!`);
      await message.channel.send(`<@${inviterId}>, your invite was accepted!`);
    } else if (reaction.emoji.name === '❌') {
      await inviteMsg.reply(`❌ <@${userToInviteId}> declined the clan invite.`);
      await message.channel.send(`<@${inviterId}>, your invite was declined.`);
    }
    // Optionally clear reactions here or disable collector to prevent more reacts
    collector.stop();
  });

  collector.on('end', (collected) => {
    if (collected.size === 0) {
      inviteMsg.reply(`⌛ <@${userToInviteId}> did not respond in time. Invite expired.`);
      // Optionally notify inviter here
    }
  });
}


    // CLAN DEMOTE/PROMOTE
      // $clan promote @user
      if (content.startsWith(`${PREFIX}clan promote`)) {
        const clanEntry = Object.entries(clans).find(([_, clan]) => clan.owner === userId);
        if (!clanEntry) return message.reply("❌ You must be a clan leader to promote members.");

        const mention = message.mentions.users.first();
        if (!mention) return message.reply("❌ Please mention a user to promote.");

        const clan = clanEntry[1];
        const clanName = clanEntry[0];
        const targetId = mention.id;

        if (targetId === userId) return message.reply("❌ You can't promote yourself.");
        if (!clan.members.includes(targetId)) return message.reply("❌ That user is not in your clan.");

        const times = (message.content.match(/promote/g) || []).length;

        if (times === 1) {
          if (!clan.elders.includes(targetId)) {
            clan.elders.push(targetId);
            saveClans();
            return message.reply(`🛡️ ${mention.username} has been promoted to **Elder**.`);
          } else {
            return message.reply("❗ This user is already an Elder.");
          }
        } else if (times >= 2) {
          if (!clan.coLeaders.includes(targetId)) {
            clan.coLeaders.push(targetId);
            // Remove from elders if they're promoted up
            clan.elders = clan.elders.filter(id => id !== targetId);
            saveClans();
            return message.reply(`👑 ${mention.username} has been promoted to **Co-Leader**.`);
          } else {
            return message.reply("❗ This user is already a Co-Leader.");
          }
        }
      }

      // $clan demote @user
      if (content.startsWith(`${PREFIX}clan demote`)) {
        const clanEntry = Object.entries(clans).find(([_, clan]) => clan.owner === userId);
        if (!clanEntry) return message.reply("❌ You must be a clan leader to demote members.");

        const mention = message.mentions.users.first();
        if (!mention) return message.reply("❌ Please mention a user to demote.");

        const clan = clanEntry[1];
        const clanName = clanEntry[0];
        const targetId = mention.id;

        const times = (message.content.match(/demote/g) || []).length;

        if (times === 1) {
          if (clan.coLeaders.includes(targetId)) {
            clan.coLeaders = clan.coLeaders.filter(id => id !== targetId);
            if (!clan.elders.includes(targetId)) clan.elders.push(targetId);
            saveClans();
            return message.reply(`⬇️ ${mention.username} has been demoted to **Elder**.`);
          } else if (clan.elders.includes(targetId)) {
            return message.reply("❗ This user is already an Elder.");
          } else {
            return message.reply("❌ That user is not a Co-Leader or Elder.");
          }
        } else if (times >= 2) {
          if (clan.coLeaders.includes(targetId) || clan.elders.includes(targetId)) {
            clan.coLeaders = clan.coLeaders.filter(id => id !== targetId);
            clan.elders = clan.elders.filter(id => id !== targetId);
            clan.members = clan.members.filter(id => id !== targetId);
            saveClans();
            return message.reply(`❌ ${mention.username} has been removed from the clan.`);
          } else {
            return message.reply("❌ That user holds no rank in your clan.");
          }
        }
      }

      // CLAN INFO
      if (content.startsWith(`${PREFIX}clan info`)) {
  const clanEntry = Object.entries(clans).find(([_, clan]) =>
    clan.owner === userId ||
    clan.coLeaders?.includes(userId) ||
    clan.elders?.includes(userId) ||
    clan.members?.includes(userId)
  );

  if (!clanEntry) return message.reply("❌ You are not in a clan.");

  const [clanName, clan] = clanEntry;

  // Ensure values are initialized
  clan.vault = clan.vault ?? 0;
  clan.level = clan.level ?? 1;
  clan.goal = clan.goal ?? 10_000_000;

  // ✅ Recalculate level and goal based on total vault (do NOT reduce vault)
  const baseGoal = 10_000_000;
  clan.level = Math.floor(clan.vault / baseGoal) + 1;
  clan.goal = baseGoal * clan.level;

  // Save updated values
  saveClans();

  // Fetch users
  const ownerUser = await client.users.fetch(clan.owner).catch(() => null);
  const coLeaderUsers = await Promise.all(
    (clan.coLeaders ?? []).map(id => client.users.fetch(id).catch(() => null))
  );
  const elderUsers = await Promise.all(
    (clan.elders ?? []).map(id => client.users.fetch(id).catch(() => null))
  );
  const memberUsers = await Promise.all(
    (clan.members ?? []).map(id => client.users.fetch(id).catch(() => null))
  );

  // Format usernames
  const formatUsers = (users: (any | null)[]) =>
    users.length > 0
      ? users.filter(Boolean).map(u => u.username).join(', ')
      : "None";

  // Final clan info message
  const embedMessage = `🏰 **Clan Info: ${clan.name}**

📊 **Level**: ${clan.level}
🎯 **Next Goal**: ${clan.goal.toLocaleString()} coins  
💰 **Vault Deposited**: ${clan.vault.toLocaleString()} coins

👑 **Leader**: ${ownerUser?.username ?? 'Unknown'}  
👥 **Co-Leaders**: ${formatUsers(coLeaderUsers)}  
🛡️ **Elders**: ${formatUsers(elderUsers)}  
🧍 **Members**: ${formatUsers(memberUsers)}
`;

  return message.reply(embedMessage);
}

  // CLAN WEEKLY
  if (content === `${PREFIX}clan weekly`) {
  const now = Date.now();
  const lastUsed = cooldowns[userId]?.clanWeekly ?? 0;
  const WEEKLY_COOLDOWN = 7 * 24 * 60 * 60 * 1000;

  if (now - lastUsed < WEEKLY_COOLDOWN) {
    const remaining = WEEKLY_COOLDOWN - (now - lastUsed);
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    return message.reply(`🕓 You already claimed your clan weekly. Try again in **${hours}h ${minutes}m**.`);
  }

  // Find the user's clan
  const clanEntry = Object.entries(clans).find(([, c]) =>
    [c.owner, ...c.coLeaders, ...c.elders, ...c.members].includes(userId)
  );

  if (!clanEntry) {
    return message.reply("❌ You are not in any clan.");
  }

  const [clanKey, clan] = clanEntry;

  // Generate reward
  const reward = Math.floor(Math.random() * (100000 - 50000 + 1)) + 50000;

  // Add to clan vault
  clan.vault += reward;

  // Track user contribution
  if (!clan.contributions[userId]) {
    clan.contributions[userId] = 0;
  }
  clan.contributions[userId] += reward;

  // Save cooldown
  cooldowns[userId] = { ...cooldowns[userId], clanWeekly: now };

  // Save data
  saveClans();
  saveCooldowns();

  return message.reply(`🎁 You contributed **${reward.toLocaleString()}** coins to **${clan.name}**'s vault!`);
}



      // CLAN DEPOSIT
      if (content.startsWith(`${PREFIX}clan deposit`)) {
  const parts = content.split(" ");
  const amount = Number(parts[2]);

  if (!amount || isNaN(amount) || amount <= 0) {
    return message.reply(`❌ Usage: \`${PREFIX}clan deposit <amount>\``);
  }

  if ((balances[userId] ?? 0) < amount) {
    return message.reply("❌ You don't have enough coins.");
  }

  const clanEntry = Object.entries(clans).find(([_, clan]) =>
    clan.owner === userId ||
    clan.coLeaders.includes(userId) ||
    clan.elders.includes(userId) ||
    clan.members.includes(userId)
  );

  if (!clanEntry) return message.reply("❌ You are not in a clan.");

  const [clanName, clan] = clanEntry;

  // Ensure base values
  clan.vault = (clan.vault ?? 0) + amount;
  clan.contributions = clan.contributions ?? {};
clan.contributions[userId] = (clan.contributions[userId] ?? 0) + amount;

  clan.level = clan.level ?? 1;

  // Recalculate level and goal based on total vault
  const baseGoal = 10_000_000;
  clan.level = Math.floor(clan.vault / baseGoal) + 1;
  clan.goal = baseGoal * clan.level;

  // Subtract from user's balance
  balances[userId] = (balances[userId] ?? 0) - amount;

  saveBalances();
  saveClans();

  return message.reply(`✅ Deposited **${amount.toLocaleString()}** coins to **${clan.name}**'s vault.`);
}

    //CLAN PROFILE

    if (content.startsWith(`${PREFIX}clan profile`)) {
  const clanEntry = Object.entries(clans).find(([_, clan]) =>
    clan.owner === userId ||
    clan.coLeaders?.includes(userId) ||
    clan.elders?.includes(userId) ||
    clan.members?.includes(userId)
  );

  if (!clanEntry) return message.reply("❌ You are not in a clan.");

  const [clanName, clan] = clanEntry;

  const userContribution = clan.contributions?.[userId] ?? 0;
  const percent = clan.vault > 0 ? ((userContribution / clan.vault) * 100).toFixed(2) : "0.00";

  const messageContent = `📄 **Clan Profile**

👤 User: <@${userId}>
🏰 Clan: **${clan.name}**

💰 Your Contribution: **${userContribution.toLocaleString()}** coins
📊 Percent of Vault: **${percent}%**
`;

  return message.reply(messageContent);
}

//clan leave
if (content.startsWith(`${PREFIX}clan leave`)) {
  const clanEntry = Object.entries(clans).find(([_, clan]) =>
    clan.owner === userId ||
    clan.coLeaders.includes(userId) ||
    clan.elders.includes(userId) ||
    clan.members.includes(userId)
  );

  if (!clanEntry) {
    return message.reply("❌ You are not in a clan.");
  }

  const [clanKey, clan] = clanEntry;

  if (clan.owner === userId) {
    return message.reply("❌ You are the clan leader. You must transfer ownership or delete the clan to leave.");
  }

  // Remove user from all role arrays
  clan.coLeaders = clan.coLeaders.filter(id => id !== userId);
  clan.elders = clan.elders.filter(id => id !== userId);
  clan.members = clan.members.filter(id => id !== userId);

  saveClans();

  // Remove clan tag from nickname
  const member = message.guild.members.cache.get(userId);
  if (member) {
    try {
      await setClanNickname(member, null); // null removes clan tag from nickname
    } catch (err) {
      console.error(`Failed to remove clan tag from nickname of ${member.user.tag}:`, err);
    }
  }

  return message.reply(`✅ You have successfully left the clan **${clan.name}**.`);
}

  async function setClanNickname(member: GuildMember, clanTag: string | null) {
  // Remove any existing clan tag (superscript letters) from the end
  const baseName = member.displayName.replace(/[\u1d00-\u1d7f]+$/u, '').trim();
  const newNick = clanTag ? `${baseName}${clanTag}` : baseName;

  await member.setNickname(newNick);
}


//CLAN LB
if (content.startsWith(`${PREFIX}clan lb`)) {
  const topClans = Object.entries(clans)
    .sort(([, a], [, b]) => (b.vault ?? 0) - (a.vault ?? 0))
    .slice(0, 10);

  if (topClans.length === 0) {
    return message.reply("📉 No clans found in the leaderboard.");
  }

  let leaderboard = `🏆 **Clan Leaderboard** (Top ${topClans.length})\n\n`;

  topClans.forEach(([name, clan], index) => {
    leaderboard += `**${index + 1}. ${clan.name}**\n` +
                   `💰 Vault: ${clan.vault.toLocaleString()} coins\n` +
                   `📊 Level: ${clan.level}\n\n`;
  });

  return message.reply(leaderboard);
}


//CLAN TRANSFER
if (content.startsWith(`${PREFIX}clan transfer`)) {
  const mention = message.mentions.users.first();

  if (!mention) {
    return message.reply(`❌ Usage: \`${PREFIX}clan transfer @user\``);
  }

  const targetId = mention.id;

  const clanEntry = Object.entries(clans).find(([_, clan]) => clan.owner === userId);

  if (!clanEntry) {
    return message.reply("❌ You are not the owner of any clan.");
  }

  const [clanName, clan] = clanEntry;

  const isInClan =
    clan.members.includes(targetId) ||
    clan.elders.includes(targetId) ||
    clan.coLeaders.includes(targetId);

  if (!isInClan) {
    return message.reply("❌ The mentioned user must be a member of your clan.");
  }

  if (targetId === userId) {
    return message.reply("❌ You already own this clan.");
  }

  // Transfer ownership
  clan.coLeaders = clan.coLeaders.includes(userId)
    ? clan.coLeaders
    : [...clan.coLeaders, userId];

  clan.owner = targetId;

  // Remove new owner from other role arrays
  clan.members = clan.members.filter(id => id !== targetId);
  clan.elders = clan.elders.filter(id => id !== targetId);
  clan.coLeaders = clan.coLeaders.filter(id => id !== targetId);

  saveClans();

  return message.reply(`✅ Clan ownership has been transferred to <@${targetId}>.`);
}

// CLAN KICK
if (content.startsWith(`${PREFIX}clan kick`)) {
  const mention = message.mentions.users.first();

  if (!mention) {
    return message.reply(`❌ Usage: \`${PREFIX}clan kick @user\``);
  }

  const targetId = mention.id;

  const clanEntry = Object.entries(clans).find(([_, clan]) =>
    clan.owner === userId || clan.coLeaders.includes(userId)
  );

  if (!clanEntry) {
    return message.reply("❌ You are not a leader or co-leader of any clan.");
  }

  const [clanName, clan] = clanEntry;

  if (targetId === userId) {
    return message.reply("❌ You can't kick yourself.");
  }

  const isTargetInClan =
    clan.members.includes(targetId) ||
    clan.elders.includes(targetId) ||
    clan.coLeaders.includes(targetId);

  if (!isTargetInClan) {
    return message.reply("❌ That user is not in your clan.");
  }

  // 🛑 Only the owner can kick another co-leader
  if (clan.coLeaders.includes(targetId) && clan.owner !== userId) {
    return message.reply("❌ Only the clan leader can kick co-leaders.");
  }

  // Remove the target from all roles
  clan.members = clan.members.filter(id => id !== targetId);
  clan.elders = clan.elders.filter(id => id !== targetId);
  clan.coLeaders = clan.coLeaders.filter(id => id !== targetId);

  saveClans();

  return message.reply(`✅ <@${targetId}> has been kicked from **${clan.name}**.`);
}

  //CLAN DISBAND
  if (content.startsWith(`${PREFIX}clan disband`)) {
  const clanEntry = Object.entries(clans).find(([_, clan]) => clan.owner === userId);

  if (!clanEntry) {
    return message.reply("❌ You are not the owner of any clan.");
  }

  const [clanName, clan] = clanEntry;

  // Delete the clan
  delete clans[clanName];
  saveClans();

  // Optional: Remove clan from all users if you're tracking that
  // If you use a `users` object to track which clan someone is in:
  /*
  const allMembers = [
    clan.owner,
    ...clan.coLeaders,
    ...clan.elders,
    ...clan.members
  ];

  for (const id of allMembers) {
    if (users[id]) {
      delete users[id].clan;
    }
  }
  saveUsers();
  */

  return message.reply(`⚠️ **${clanName}** has been disbanded and removed from the server.`);
}





    // HELP

    if (content === `${PREFIX}h`) {
      const helpMessage = `
    **📜 Economy Bot Commands**

    💰 **Economy:**
    \`${PREFIX}balance [@user]\` or \`${PREFIX}bal [@user]\` – Check your or someone else's balance
    \`${PREFIX}daily\` – Claim daily coins
    \`${PREFIX}weekly\` – Claim weekly reward
    \`${PREFIX}beg\` – Beg for coins
    \`${PREFIX}give @user <amount>\` – Give coins to another user

    🎰 **Gambling:**
    \`${PREFIX}coinflip <amount> <heads/tails or h/t>\` or \`${PREFIX}cf <amount> <heads/tails or h/t>\` – Flip a coin and gamble coins
    \`${PREFIX}slots <amount>\` – Spin the slot machine

    🛒 **Shop & Inventory:**
    \`${PREFIX}shop\` – View items available in the shop
    \`${PREFIX}buy <item number>\` – Buy an item from the shop
    \`${PREFIX}inventory\` – See your owned items

    📈 **Leaderboard:**
    \`${PREFIX}eclb\` or \`${PREFIX}economyleaderboard\` or \`${PREFIX}economylb\` – View top richest users
    \`${PREFIX}clan lb\` – View top clans

    📈 **Clans:**
    \`${PREFIX}clan create <clan_name>\` – Create your own clan
    \`${PREFIX}clan join <clan_name>\` – Join public clans
    \`${PREFIX}clan public/private\` – Make your clan public or private
    \`${PREFIX}clan leave\` – Leave clan
    \`${PREFIX}clan transfer\` – Transfer ownership
    \`${PREFIX}clan promote/demote <mention>\` – Promote or demote anyone
    \`${PREFIX}clan invite <mention>\` – Invite members
    \`${PREFIX}clan deposit <amount>\` – Deposit for your clan
    \`${PREFIX}clan info\` – View clan infos
    \`${PREFIX}clan disband\` – Disband your clan
    \`${PREFIX}clan kick <mention>\` – Kick your clan members
    \`${PREFIX}clan profile\` – View your clan profile
      `;

      return message.reply(helpMessage);
    }

    if (message.content === '$servers') {
  const guilds = client.guilds.cache.map(guild => `${guild.name} (ID: ${guild.id})`);
  const reply = `🤖 I'm currently in ${guilds.length} server(s):\n\`\`\`\n${guilds.join('\n')}\n\`\`\``;

  message.reply(reply);
}



});

client.login(process.env.DISCORD_BOT_TOKEN);
