require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  StringSelectMenuBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { registerSystemFonts, generateLevelUpCard, generateRankCard, generateLeaderboardCard, generateTarotOneCard, generateTarotThreeCards } = require('./canvas_utils');
const levelMessages = require('./assets/level_messages.json');
const taroDeck = require('./assets/taro.json');

// Local storage directory for ticket logs
const TICKET_LOG_DIR = path.join(__dirname, 'TICKET_LOG');

// Validate env config
if (!process.env.DISCORD_TOKEN || !process.env.ALLOWED_GUILD_ID) {
  console.error('Error: DISCORD_TOKEN and ALLOWED_GUILD_ID are required in .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Ensure TICKET_LOG subdirectories exist
fs.mkdirSync(path.join(TICKET_LOG_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(TICKET_LOG_DIR, 'transcripts'), { recursive: true });
fs.mkdirSync(path.join(TICKET_LOG_DIR, 'db'), { recursive: true });

// ─── Local Ticket DB Helpers ───────────────────────────────────────────────
const TICKETS_DB_PATH = path.join(TICKET_LOG_DIR, 'db', 'tickets.json');

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function loadTickets() {
  try {
    if (!fs.existsSync(TICKETS_DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(TICKETS_DB_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveTickets(tickets) {
  fs.writeFileSync(TICKETS_DB_PATH, JSON.stringify(tickets, null, 2), 'utf8');
}

function findTicket(predicate) {
  return loadTickets().find(predicate) || null;
}

function insertTicket(record) {
  const tickets = loadTickets();
  const newRecord = { id: generateId(), created_at: new Date().toISOString(), ...record };
  tickets.push(newRecord);
  saveTickets(tickets);
  return newRecord;
}

function upsertTicket(predicate, update) {
  const tickets = loadTickets();
  const idx = tickets.findIndex(predicate);
  if (idx !== -1) {
    tickets[idx] = { ...tickets[idx], ...update };
    saveTickets(tickets);
    return tickets[idx];
  }
  return null;
}

function searchTickets(query) {
  const q = query.toLowerCase();
  return loadTickets().filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.description || '').toLowerCase().includes(q) ||
    (t.creator_username || '').toLowerCase().includes(q)
  ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 25);
}
// ──────────────────────────────────────────────────────────────────────────────

// ─── Local Leveling DB Helpers ───────────────────────────────────────────────
const LEVELING_DB_PATH = path.join(TICKET_LOG_DIR, 'db', 'leveling.json');

function loadLevelingDb() {
  try {
    if (!fs.existsSync(LEVELING_DB_PATH)) {
      return { guilds: {}, users: {} };
    }
    return JSON.parse(fs.readFileSync(LEVELING_DB_PATH, 'utf8'));
  } catch {
    return { guilds: {}, users: {} };
  }
}

function saveLevelingDb(db) {
  try {
    fs.writeFileSync(LEVELING_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save leveling db:', err);
  }
}

function getGuildLevelingSettings(guildId) {
  const db = loadLevelingDb();
  if (!db.guilds) db.guilds = {};
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      leveling_enabled: true,
      rewards: []
    };
    saveLevelingDb(db);
  }
  return db.guilds[guildId];
}

function setGuildLevelingEnabled(guildId, enabled) {
  const db = loadLevelingDb();
  if (!db.guilds) db.guilds = {};
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = { leveling_enabled: true, rewards: [] };
  }
  db.guilds[guildId].leveling_enabled = enabled;
  saveLevelingDb(db);
}

function setupLevelReward(guildId, level, roleId) {
  const db = loadLevelingDb();
  if (!db.guilds) db.guilds = {};
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = { leveling_enabled: true, rewards: [] };
  }
  if (!db.guilds[guildId].rewards) {
    db.guilds[guildId].rewards = [];
  }
  db.guilds[guildId].rewards = db.guilds[guildId].rewards.filter(r => r.level !== level);
  db.guilds[guildId].rewards.push({ level, role_id: roleId });
  db.guilds[guildId].rewards.sort((a, b) => b.level - a.level);
  saveLevelingDb(db);
}

function getUserLevelData(guildId, userId) {
  const db = loadLevelingDb();
  if (!db.users) db.users = {};
  if (!db.users[guildId]) db.users[guildId] = {};
  if (!db.users[guildId][userId]) {
    db.users[guildId][userId] = { total_chars: 0 };
  }
  return db.users[guildId][userId];
}

function updateUserChars(guildId, userId, addedChars) {
  const db = loadLevelingDb();
  if (!db.users) db.users = {};
  if (!db.users[guildId]) db.users[guildId] = {};
  if (!db.users[guildId][userId]) {
    db.users[guildId][userId] = { total_chars: 0 };
  }
  const oldChars = db.users[guildId][userId].total_chars || 0;
  const newChars = oldChars + addedChars;
  db.users[guildId][userId].total_chars = newChars;
  saveLevelingDb(db);
  return { oldChars, newChars };
}

// ─── Local Voice Rooms DB Helpers ───────────────────────────────────────────
const VOICE_ROOMS_DB_PATH = path.join(TICKET_LOG_DIR, 'db', 'voice_rooms.json');

function loadVoiceRoomsDb() {
  try {
    if (!fs.existsSync(VOICE_ROOMS_DB_PATH)) {
      return { guilds: {} };
    }
    return JSON.parse(fs.readFileSync(VOICE_ROOMS_DB_PATH, 'utf8'));
  } catch {
    return { guilds: {} };
  }
}

function saveVoiceRoomsDb(db) {
  try {
    fs.writeFileSync(VOICE_ROOMS_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save voice rooms db:', err);
  }
}

function getGuildVoiceSettings(guildId) {
  const db = loadVoiceRoomsDb();
  if (!db.guilds) db.guilds = {};
  return db.guilds[guildId] || null;
}

function setGuildVoiceSettings(guildId, settings) {
  const db = loadVoiceRoomsDb();
  if (!db.guilds) db.guilds = {};
  db.guilds[guildId] = {
    ...db.guilds[guildId],
    ...settings
  };
  saveVoiceRoomsDb(db);
}

function addActiveRoom(guildId, channelId, ownerId, slotNumber) {
  const db = loadVoiceRoomsDb();
  if (!db.guilds) db.guilds = {};
  if (!db.guilds[guildId]) db.guilds[guildId] = { active_rooms: [] };
  if (!db.guilds[guildId].active_rooms) db.guilds[guildId].active_rooms = [];
  
  db.guilds[guildId].active_rooms.push({
    channel_id: channelId,
    owner_id: ownerId,
    slot_number: slotNumber,
    created_at: new Date().toISOString()
  });
  saveVoiceRoomsDb(db);
}

function removeActiveRoom(guildId, channelId) {
  const db = loadVoiceRoomsDb();
  if (!db.guilds || !db.guilds[guildId] || !db.guilds[guildId].active_rooms) return;
  db.guilds[guildId].active_rooms = db.guilds[guildId].active_rooms.filter(r => r.channel_id !== channelId);
  saveVoiceRoomsDb(db);
}

function scheduleVoiceRoomDeletion(guildId, channelId) {
  if (!client.voiceRoomTimeouts) client.voiceRoomTimeouts = new Map();
  
  // Clear any existing timers first
  clearVoiceRoomDeletion(channelId);

  const timers = [];

  const checkEmpty = async (guild) => {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    return channel && channel.members.size === 0;
  };

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // 1. Warning 1 (5 minutes remaining / 5 minutes elapsed)
  timers.push(setTimeout(async () => {
    try {
      if (await checkEmpty(guild)) {
        const channel = await guild.channels.fetch(channelId);
        await channel.send('⚠️ **แจ้งเตือนครั้งที่ 1/3**: ห้องนี้ไม่มีการใช้งานแล้วเมี๊ยว🐾 จะถูกลบอัตโนมัติในอีก **5 นาที** หากไม่มีใครเข้ามาร่วมใช้งาน');
      }
    } catch (err) {
      console.error('Warning 1 error:', err);
    }
  }, 5 * 60 * 1000));

  // 2. Warning 2 (2 minutes remaining / 8 minutes elapsed)
  timers.push(setTimeout(async () => {
    try {
      if (await checkEmpty(guild)) {
        const channel = await guild.channels.fetch(channelId);
        await channel.send('⚠️ **แจ้งเตือนครั้งที่ 2/3**: ห้องนี้ยังคงไม่มีการใช้งานเมี๊ยว🐾 จะถูกลบอัตโนมัติในอีก **2 นาที**');
      }
    } catch (err) {
      console.error('Warning 2 error:', err);
    }
  }, 8 * 60 * 1000));

  // 3. Warning 3 (30 seconds remaining / 9.5 minutes elapsed)
  timers.push(setTimeout(async () => {
    try {
      if (await checkEmpty(guild)) {
        const channel = await guild.channels.fetch(channelId);
        await channel.send('🚨 **แจ้งเตือนสุดท้าย!**: ห้องนี้จะถูกลบในอีก **30 วินาที** เมี๊ยว🐾');
      }
    } catch (err) {
      console.error('Warning 3 error:', err);
    }
  }, 9.5 * 60 * 1000));

  // 4. Deletion (10 minutes elapsed)
  timers.push(setTimeout(async () => {
    try {
      if (await checkEmpty(guild)) {
        const channel = await guild.channels.fetch(channelId);
        if (channel) {
          await channel.delete('ไม่มีการใช้งานนานเกิน 10 นาที');
          removeActiveRoom(guildId, channelId);
          client.voiceRoomTimeouts.delete(channelId);
          console.log(`Deleted empty voice channel ${channelId}`);
        }
      }
    } catch (err) {
      console.error('Deletion error:', err);
    }
  }, 10 * 60 * 1000));

  client.voiceRoomTimeouts.set(channelId, timers);
}

function clearVoiceRoomDeletion(channelId) {
  if (!client.voiceRoomTimeouts) return;
  const timers = client.voiceRoomTimeouts.get(channelId);
  if (timers && Array.isArray(timers)) {
    timers.forEach(t => clearTimeout(t));
    client.voiceRoomTimeouts.delete(channelId);
    console.log(`Cleared all scheduled timers for channel ${channelId}`);
  }
}
// ──────────────────────────────────────────────────────────────────────────────


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.voiceRoomTimeouts = new Map();

// Role IDs
const ROLES = {
  ACTIVE_TICKET: process.env.DISCORD_ROLE_ACTIVE_TICKET || '1520385096954151115',
  NEWCOMER: process.env.DISCORD_ROLE_NEWCOMER || '1518536210769772555',
  MEMBER: process.env.DISCORD_ROLE_MEMBER || '1518536208785870868',
  STAFF: process.env.DISCORD_ROLE_STAFF || '1520446127357300938',
  MODERATOR: process.env.DISCORD_ROLE_MODERATOR || '1518536207020064828',
  ADMIN: process.env.DISCORD_ROLE_ADMIN || '1518536204637704292'
};

// Guard helper: leaves any unauthorized guild and returns false
async function guardGuild(guild) {
  if (!guild) return false;
  if (guild.id !== process.env.ALLOWED_GUILD_ID) {
    console.warn(`Attempted run in unauthorized guild: ${guild.name} (${guild.id}). Leaving guild...`);
    try {
      await guild.leave();
    } catch (err) {
      console.error(`Failed to leave unauthorized guild ${guild.id}:`, err);
    }
    return false;
  }
  return true;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Register custom canvas fonts
  registerSystemFonts();

  // Check current guilds bot is in and leave any unauthorized ones
  for (const [guildId, guild] of client.guilds.cache) {
    await guardGuild(guild);
  }

  // Initialize inactivity timers for empty voice rooms on startup
  try {
    const voiceDb = loadVoiceRoomsDb();
    if (voiceDb && voiceDb.guilds) {
      for (const guildId of Object.keys(voiceDb.guilds)) {
        const guildSettings = voiceDb.guilds[guildId];
        if (!guildSettings || !guildSettings.active_rooms) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        for (const room of [...guildSettings.active_rooms]) {
          const channel = await guild.channels.fetch(room.channel_id).catch(() => null);
          if (!channel) {
            // Channel no longer exists, remove from db
            removeActiveRoom(guildId, room.channel_id);
            continue;
          }

          if (channel.members.size === 0) {
            scheduleVoiceRoomDeletion(guildId, room.channel_id);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to initialize voice room timers on startup:', err);
  }

  // Register slash commands (Only for the allowed Guild for immediate updates and lock)
  const commands = [
    new SlashCommandBuilder()
      .setName('register')
      .setDescription('คำสั่งสำหรับแอดมินในการตั้งค่าระบบลงทะเบียน')
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('สร้างปุ่มลงทะเบียนสำหรับเชื่อมต่อบัญชี Discord')
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('คำสั่งสำหรับแอดมินในการตั้งค่าระบบ Ticket')
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('สร้างปุ่มสำหรับเปิดห้อง Ticket')
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('member')
      .setDescription('คำสั่งสำหรับแอดมินในการตั้งค่าระบบสมาชิก')
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('สร้างแผงรับยศสำหรับสมาชิกใหม่')
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('staffticket')
      .setDescription('คำสั่งสำหรับแอดมินในการตั้งค่าระบบ Staff Ticket')
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('สร้างปุ่มสำหรับเปิดห้อง Staff Ticket ถึง Admin')
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('searchlog')
      .setDescription('สืบค้นประวัติ Ticket Log จากฐานข้อมูล (เฉพาะทีมงาน)')
      .addStringOption(option =>
        option
          .setName('query')
          .setDescription('ระบุหัวข้อ, ชื่อผู้ส่ง, หรือรายละเอียดที่ต้องการสืบค้น')
          .setRequired(true)
      )
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('leveling')
      .setDescription('🏆 จัดการระบบสะสมเลเวลสำหรับน้องแมวรักการพิมพ์เมี๊ยว🐾')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand => subcommand.setName('enable').setDescription('🐾 เปิดใช้งานระบบสะสมเลเวลให้สมาชิกฝนเล็บพิมพ์คุยกันเมี๊ยว!'))
      .addSubcommand(subcommand => subcommand.setName('disable').setDescription('🚫 ปิดใช้งานระบบสะสมเลเวลแชทชั่วคราวเมี๊ยว🐾'))
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('🐱 ขอดูบัตรประจำตัวแมวและระดับการฝนเล็บแชทหน่อยเมี๊ยว🐾')
      .addUserOption(option => option.setName('user').setDescription('เลือกน้องแมวที่ต้องการส่องบัตรประจำตัวเมี๊ยว'))
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('🏆 ตารางอันดับน้องแมวผู้ฝนเล็บแชทเยอะที่สุดในเซิร์ฟเวอร์เมี๊ยว🐾')
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('taro')
      .setDescription('🔮 ทำนายดวงชะตาด้วยไพ่ยิปซีฉบับน้องแมวเหมียว 🐾')
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('รูปแบบการดูดวงเมี๊ยว')
          .setRequired(false)
          .addChoices(
            { name: 'ไพ่ 1 ใบ (ทำนายรายวัน/หาคำตอบ)', value: '1_card' },
            { name: 'ไพ่ 3 ใบ (อดีต ปัจจุบัน อนาคต)', value: '3_cards' }
          )
      )
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName('room')
      .setDescription('🔊 ระบบห้องเสียงชั่วคราว (Join to Create)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('สร้างห้องหลักสำหรับกดสร้างห้องใหม่ (+)')
          .addIntegerOption(option =>
            option
              .setName('slots')
              .setDescription('จำนวนห้องชั่วคราวที่สร้างได้สูงสุด (ค่าเริ่มต้น: 10)')
              .setRequired(false)
          )
      )
      .setDMPermission(false)
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log(`Started refreshing application (/) commands for Guild ${process.env.ALLOWED_GUILD_ID}.`);
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.ALLOWED_GUILD_ID),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering application commands:', error);
  }
});

// Auto-leave if added to a new guild
client.on('guildCreate', async (guild) => {
  console.log(`Added to guild: ${guild.name} (${guild.id})`);
  await guardGuild(guild);
});

// Auto assign newcomer role on join
client.on('guildMemberAdd', async (member) => {
  // Guild Guard Check
  if (member.guild.id !== process.env.ALLOWED_GUILD_ID) return;

  console.log(`New member joined: ${member.user.tag} (${member.id})`);
  try {
    const newcomerRole = member.guild.roles.cache.get(ROLES.NEWCOMER);
    if (newcomerRole) {
      await member.roles.add(newcomerRole);
      console.log(`Assigned "🥚 | Newcomer" role to ${member.user.tag}`);
    } else {
      console.warn('Newcomer role not found on the guild.');
    }
  } catch (err) {
    console.error(`Failed to assign newcomer role to ${member.user.tag}:`, err);
  }
});

// ─── Leveling Event / Message Handler ───────────────────────────────────────
client.on('messageCreate', async (message) => {
  // Exclude bot messages, direct messages, and restrict to allowed guild
  if (message.author.bot || !message.guild || message.guild.id !== process.env.ALLOWED_GUILD_ID) return;

  const guildId = message.guild.id;
  const settings = getGuildLevelingSettings(guildId);

  // If leveling is disabled, do nothing
  if (settings.leveling_enabled === false) return;

  // Initialize Cooldown map if not exists
  if (!client.xpCooldowns) client.xpCooldowns = new Map();
  const cooldownKey = `${guildId}-${message.author.id}`;
  const lastXP = client.xpCooldowns.get(cooldownKey) || 0;
  const now = Date.now();

  const xpMultiplier = 100;
  const chatCharCount = message.content.length;

  // Award XP if character count > 0 and 60 seconds cooldown elapsed
  if (chatCharCount > 0 && (now - lastXP > 60000)) {
    client.xpCooldowns.set(cooldownKey, now);

    // Non-blocking update
    (async () => {
      try {
        const { oldChars, newChars } = updateUserChars(guildId, message.author.id, chatCharCount);

        const oldLevel = Math.floor(Math.sqrt(oldChars / xpMultiplier));
        const newLevel = Math.floor(Math.sqrt(newChars / xpMultiplier));

        if (newLevel > oldLevel && newLevel > 0) {
          const { AttachmentBuilder } = require('discord.js');
          const displayName = message.member?.displayName || message.author.username;
          const avatarURL = message.member?.displayAvatarURL({ extension: 'png', size: 256 }) || message.author.displayAvatarURL({ extension: 'png', size: 256 });
          
          const imageBuffer = await generateLevelUpCard(
            message.author,
            newLevel,
            levelMessages[newLevel.toString()] || `🐾 พระเจ้าแมวเหมียวระดับ ${newLevel} คุมทั้งเซิร์ฟเวอร์แล้วเมี๊ยว! 👑🐾`,
            displayName,
            avatarURL
          );
          
          const attachment = new AttachmentBuilder(imageBuffer, { name: `levelup-${message.author.id}.png` });

          await message.reply({
            content: `🎊 **ยินดีด้วยนะ! <@${message.author.id}> เลเวลอัพแล้ว!** 🐾✨`,
            files: [attachment]
          }).catch(() => {});
        }
      } catch (err) {
        console.error('Leveling error (silenced):', err);
      }
    })();
  }
});

// ─── Tarot Helper Function ──────────────────────────────────────────────────
async function handleTarotReading(interaction, type) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  // Pick random cards (1 or 3) out of 78 (taroDeck.length)
  const drawCount = type === '3_cards' ? 3 : 1;
  const selectedIndexes = [];
  while (selectedIndexes.length < drawCount) {
    const randIdx = Math.floor(Math.random() * taroDeck.length);
    if (!selectedIndexes.includes(randIdx)) {
      selectedIndexes.push(randIdx);
    }
  }

  const selectedCards = selectedIndexes.map(idx => taroDeck[idx]);
  const reverseds = selectedCards.map(() => Math.random() < 0.5); // 50/50 upright/reversed

  const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tarot_draw_1')
      .setLabel('🔮 ดูดวงชะตาของฉัน (1 ใบ)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('tarot_draw_3')
      .setLabel('🔮 ดูดวงชะตาของฉัน (3 ใบ)')
      .setStyle(ButtonStyle.Secondary)
  );

  const guildId = interaction.guild.id;
  const userName = interaction.member ? interaction.member.displayName : interaction.user.username;

  if (type === '1_card') {
    const card = selectedCards[0];
    const isReversed = reverseds[0];
    const cardPath = path.join(__dirname, 'assets', 'taro', `${card.id}.png`);

    try {
      // Send loading state first (crescent moon card back)
      const backBuffer = await generateTarotOneCard(null, false);
      const loadingAttachment = new AttachmentBuilder(backBuffer, { name: 'tarot-back.png' });
      await interaction.editReply({
        content: `🔮 **กำลังล้างพลังลบ สับไพ่ และเปิดหน้าดวงชะตาของ <@${interaction.user.id}> เมี๊ยว...** 🐾`,
        files: [loadingAttachment],
        components: []
      });

      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate actual card
      const imageBuffer = await generateTarotOneCard(cardPath, isReversed);
      const attachment = new AttachmentBuilder(imageBuffer, { name: `tarot-${card.id}.png` });

      const details = isReversed ? card.reversed : card.upright;
      const title = `🔮 ไพ่ทาโร่ประจำวันของ ${userName}: ${card.name_en} (${card.name_th}) ${isReversed ? '(กลับหัว)' : '(หัวตั้ง)'}`;

      const description = `*${details.quote}*\n\n` +
        `### 🐱 คำทำนายรายวันจาก PurrPaw\n${details.general}\n\n` +
        `### ❤️ ความรักและความสัมพันธ์\n${details.love}\n\n` +
        `### 💼 การงานและการเงิน\n${details.work_finance}\n\n` +
        `### 🍀 สุขภาพและอารมณ์\n${details.health_emotion}\n\n` +
        `### 🐾 คำแนะนำจากอุ้งเท้าวิเศษ\n${details.advice}`;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor('#FFB6C1')
        .setDescription(description)
        .setImage(`attachment://tarot-${card.id}.png`)
        .setTimestamp()
        .setFooter({ text: 'PurrPaw Tarot Reading', iconURL: interaction.client.user.displayAvatarURL() });

      return interaction.editReply({
        content: `🔮 **ดวงชะตาของ <@${interaction.user.id}> ได้รับการทำนายแล้วเมี๊ยว!** 🐾`,
        embeds: [embed],
        files: [attachment],
        components: [row]
      });
    } catch (err) {
      console.error('Tarot error:', err);
      return interaction.editReply({ content: 'งื้อออ เกิดข้อผิดพลาดในการดูดวงเมี๊ยว🐾' });
    }
  } else {
    // 3_cards
    const cardPaths = selectedCards.map(c => path.join(__dirname, 'assets', 'taro', `${c.id}.png`));
    
    try {
      // Send loading state first (3 cards faced down)
      const backBuffer = await generateTarotThreeCards([null, null, null], [false, false, false]);
      const loadingAttachment = new AttachmentBuilder(backBuffer, { name: 'tarot-spread-back.png' });
      await interaction.editReply({
        content: `🔮 **กำลังตั้งจิตอธิษฐาน จัดสำรับไพ่ (อดีต - ปัจจุบัน - อนาคต) ของ <@${interaction.user.id}> เมี๊ยว...** 🐾`,
        files: [loadingAttachment],
        components: []
      });

      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate actual spread
      const imageBuffer = await generateTarotThreeCards(cardPaths, reverseds);
      const attachment = new AttachmentBuilder(imageBuffer, { name: `tarot-spread.png` });

      const mainEmbed = new EmbedBuilder()
        .setTitle(`🔮 ทำนายดวง 3 ใบของ ${userName} (อดีต - ปัจจุบัน - อนาคต) 🔮`)
        .setColor('#FFB6C1')
        .setImage('attachment://tarot-spread.png')
        .setTimestamp()
        .setFooter({ text: 'PurrPaw Tarot Spread', iconURL: interaction.client.user.displayAvatarURL() });

      const embeds = [mainEmbed];
      const labels = ['PAST (อดีต)', 'PRESENT (ปัจจุบัน)', 'FUTURE (อนาคต)'];

      for (let i = 0; i < 3; i++) {
        const card = selectedCards[i];
        const isReversed = reverseds[i];
        const details = isReversed ? card.reversed : card.upright;

        const cardDesc = `*${details.quote}*\n\n` +
          `* **🐱 คำทำนาย:** ${details.general}\n` +
          `* **🐾 คำแนะนำ:** ${details.advice}`;

        const cardEmbed = new EmbedBuilder()
          .setTitle(`🌟 ${labels[i]}: ${card.name_en} (${card.name_th}) ${isReversed ? '(กลับหัว)' : '(หัวตั้ง)'}`)
          .setDescription(cardDesc)
          .setColor('#FFB6C1');

        embeds.push(cardEmbed);
      }

      return interaction.editReply({
        content: `🔮 **ดวงชะตา อดีต - ปัจจุบัน - อนาคต ของ <@${interaction.user.id}> ได้รับการทำนายแล้วเมี๊ยว!** 🐾`,
        embeds: embeds,
        files: [attachment],
        components: [row]
      });
    } catch (err) {
      console.error('Tarot spread error:', err);
      return interaction.editReply({ content: 'งื้อออ เกิดข้อผิดพลาดในการทำนายดวงยิปซี 3 ใบเมี๊ยว🐾' });
    }
  }
}

client.on('interactionCreate', async (interaction) => {
  // Guild Lock Guard
  if (interaction.guildId !== process.env.ALLOWED_GUILD_ID) {
    if (interaction.guild) {
      await guardGuild(interaction.guild);
    }
    return;
  }

  // Handle Slash Command
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'register') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        // Embed details
        const embed = new EmbedBuilder()
          .setTitle('🎁 กิจกรรมเชื่อมต่อ Discord รับ 150 PAW ฟรี!')
          .setDescription(
            'ยินดีต้อนรับสู่คอมมูนิตี้อย่างเป็นทางการของเรา!\n\n' +
            'เพียงเชื่อมโยงบัญชี Discord ของคุณกับบัญชี PurrPaw ก็สามารถรับเหรียญรางวัล **150 PAW** ฟรีทันที สำหรับใช้คุยกับตัวละครที่คุณชื่นชอบ!\n\n' +
            '**วิธีรับรางวัล:**\n' +
            '1. ไปที่แอป/เว็บ PurrPaw หน้า `วอลเล็ท & รางวัล` -> แท็บ `กิจกรรม & โค้ด`\n' +
            '2. คัดลอก **Username** ของคุณ (เช่น `pp-xxxx`)\n' +
            '3. กดปุ่ม **"เชื่อมต่อบัญชี"** ด้านล่างนี้ แล้ววาง Username ลงในช่องป้อนข้อมูล'
          )
          .setColor('#5865F2') // Discord Purple
          .setFooter({ text: 'PurrPaw Community', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('register_discord_link')
            .setLabel('เชื่อมต่อบัญชี')
            .setEmoji('💬')
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
      }
    }

    if (interaction.commandName === 'ticket') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        const embed = new EmbedBuilder()
          .setTitle('🎫 ศูนย์ช่วยเหลือและติดต่อสอบถาม (Support Ticket)')
          .setDescription(
            'หากพบปัญหาในการใช้งานระบบ แจ้งปัญหา หรือต้องการติดต่อสอบถามทีมงาน\n\n' +
            'กดปุ่ม **"เปิด Ticket"** ด้านล่างนี้เพื่อสร้างช่องแชทสอบถามส่วนตัว\n' +
            '*(จะมีเพียงผู้เปิดเรื่องและทีมงาน `🛡️ Staff` / `👾 Mod` / `👑 Admin` เท่านั้นที่เห็นห้อง)*'
          )
          .setColor('#00ffb7')
          .setFooter({ text: 'PurrPaw Support', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_create')
            .setLabel('เปิด Ticket')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
      }
    }

    if (interaction.commandName === 'member') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        const embed = new EmbedBuilder()
          .setTitle('✨ ยืนยันสิทธิ์สมาชิก (Verify Member)')
          .setDescription(
            'ยินดีต้อนรับสู่คอมมูนิตี้! กรุณากดปุ่มด้านล่างเพื่อรับยศ **🎀 | Member** และเข้าถึงช่องพูดคุยต่างๆ ของเซิร์ฟเวอร์\n\n' +
            '*(เมื่อกดรับยศแล้ว ยศ `🥚 | Newcomer` จะถูกถอดออกโดยอัตโนมัติ)*'
          )
          .setColor('#2ecc71')
          .setFooter({ text: 'PurrPaw Verification', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('member_get_role')
            .setLabel('รับยศ Member')
            .setEmoji('🎀')
            .setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
      }
    }

    if (interaction.commandName === 'staffticket') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        const embed = new EmbedBuilder()
          .setTitle('🛠️ ระบบส่งเรื่องติดต่อแอดมิน (Staff Escalation)')
          .setDescription(
            'ช่องทางติดต่อสำหรับ Staff, Moderator และ Admin เพื่อส่งเรื่องช่วยเหลือหรือแจ้งปัญหาเฉพาะกิจ\n\n' +
            '**สถานะ Ticket**\n' +
            '🟢 เปิด : 0\n' +
            '🔴 ปิด : 0'
          )
          .setColor('#ffcc00')
          .setFooter({ text: 'PurrPaw Staff Operations', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('staff_ticket_create')
            .setLabel('เปิด Ticket')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('staff_ticket_search_trigger')
            .setLabel('สืบค้นประวัติ')
            .setEmoji('🔍')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
      }
    }

    if (interaction.commandName === 'searchlog') {
      const query = interaction.options.getString('query').trim();
      await performTicketSearch(interaction, query, false);
    }

    if (interaction.commandName === 'leveling') {
      const subcommand = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (subcommand === 'enable' || subcommand === 'disable') {
        const enabled = (subcommand === 'enable');
        setGuildLevelingEnabled(guildId, enabled);
        return interaction.reply({ content: `ระบบสะสมคะแนนเลเวลถูก **${enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}** แล้วนะเมี๊ยว! 🐾`, ephemeral: true });
      }
    }

    if (interaction.commandName === 'rank') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild.id;

      const userLevelData = getUserLevelData(guildId, targetUser.id);
      const totalChars = userLevelData.total_chars || 0;

      const xpMultiplier = 100;
      const level = Math.floor(Math.sqrt(totalChars / xpMultiplier));
      const currentLevelXP = xpMultiplier * (level ** 2);
      const nextLevelXP = xpMultiplier * ((level + 1) ** 2);

      const currentXP = totalChars - currentLevelXP;
      const requiredXP = nextLevelXP - currentLevelXP;

      const member = interaction.guild.members.cache.get(targetUser.id) || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const displayName = member ? member.displayName : targetUser.username;
      const avatarURL = member ? member.displayAvatarURL({ extension: 'png', size: 256 }) : targetUser.displayAvatarURL({ extension: 'png', size: 256 });

      try {
        const { AttachmentBuilder } = require('discord.js');
        const imageBuffer = await generateRankCard(
          targetUser,
          level,
          currentXP,
          requiredXP,
          displayName,
          avatarURL,
          levelMessages[level.toString()] || `🐾 พระเจ้าแมวเหมียวระดับ ${level} คุมทั้งเซิร์ฟเวอร์แล้วเมี๊ยว! 👑🐾`
        );

        const attachment = new AttachmentBuilder(imageBuffer, { name: `rank-${targetUser.id}.png` });
        return interaction.editReply({ files: [attachment] });
      } catch (err) {
        console.error('Failed to generate rank card:', err);
        return interaction.editReply({ content: 'งื้อออ เกิดข้อผิดพลาดในการสร้างการ์ดแรงค์เมี๊ยว🐾' });
      }
    }

    if (interaction.commandName === 'leaderboard') {
      await interaction.deferReply();
      const guildId = interaction.guild.id;

      const db = loadLevelingDb();
      const guildUsers = db.users?.[guildId] || {};
      const userIds = Object.keys(guildUsers);

      if (userIds.length === 0) {
        return interaction.editReply({ content: 'งื้อออ ยังไม่มีน้องแมวตัวไหนเริ่มฝนเล็บแชทกันเลยเมี๊ยว🐾' });
      }

      // Sort users by total_chars descending
      const sortedUsers = userIds
        .map(id => ({ id, total_chars: guildUsers[id].total_chars || 0 }))
        .sort((a, b) => b.total_chars - a.total_chars)
        .slice(0, 10);

      const topUsers = [];
      const xpMultiplier = 100;

      for (let i = 0; i < sortedUsers.length; i++) {
        const u = sortedUsers[i];
        const level = Math.floor(Math.sqrt(u.total_chars / xpMultiplier));

        const member = interaction.guild.members.cache.get(u.id) || await interaction.guild.members.fetch(u.id).catch(() => null);
        const username = member ? member.displayName : `Unknown (${u.id})`;
        const avatarURL = member ? member.displayAvatarURL({ extension: 'png', size: 128 }) : 'https://cdn.discordapp.com/embed/avatars/0.png';

        topUsers.push({
          username,
          avatarURL,
          level,
          totalChars: u.total_chars
        });
      }

      try {
        const { AttachmentBuilder } = require('discord.js');
        const imageBuffer = await generateLeaderboardCard(topUsers);
        const attachment = new AttachmentBuilder(imageBuffer, { name: `leaderboard-${guildId}.png` });

        return interaction.editReply({ files: [attachment] });
      } catch (err) {
        console.error('Failed to generate leaderboard card:', err);
        return interaction.editReply({ content: 'งื้อออ เกิดข้อผิดพลาดในการสร้างตารางอันดับแบบรูปภาพเมี๊ยว🐾' });
      }
    }

    if (interaction.commandName === 'taro') {
      const type = interaction.options.getString('type') || '1_card';
      return handleTarotReading(interaction, type);
    }

    if (interaction.commandName === 'room') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        const slots = interaction.options.getInteger('slots') || 10;
        const guildId = interaction.guild.id;

        await interaction.deferReply({ ephemeral: true });

        try {
          const embed = new EmbedBuilder()
            .setTitle('🔊 ระบบสร้างห้องเสียงชั่วคราว (Dynamic Voice Rooms)')
            .setDescription(
              'กดปุ่ม **"สร้างห้องเสียง"** ด้านล่างนี้ เพื่อสร้างห้องเสียงชั่วคราวของคุณเมี๊ยว🐾\n\n' +
              '**กฎและข้อตกลง:**\n' +
              '1. สมาชิก 1 คน สามารถสร้างห้องได้เพียง **1 ห้องเท่านั้น**\n' +
              '2. ห้องเสียงจะจำกัดผู้เข้าร่วมสูงสุดตามลำดับสล็อต\n' +
              '3. **หากไม่มีใครอยู่ในห้องนานเกิน 10 นาที ห้องจะถูกลบโดยอัตโนมัติ**'
            )
            .setColor('#5865F2')
            .setFooter({ text: 'PurrPaw Voice System', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('voice_room_create')
              .setLabel('สร้างห้องเสียง')
              .setEmoji('➕')
              .setStyle(ButtonStyle.Primary)
          );

          const categoryId = interaction.channel.parentId;

          setGuildVoiceSettings(guildId, {
            category_id: categoryId,
            max_slots: slots,
            active_rooms: getGuildVoiceSettings(guildId)?.active_rooms || []
          });

          await interaction.channel.send({ embeds: [embed], components: [row] });

          return interaction.editReply({ content: 'ตั้งค่าระบบห้องเสียงเรียบร้อยแล้วเมี๊ยว! แผงควบคุมถูกส่งในห้องนี้แล้ว' });
        } catch (err) {
          console.error('Error setting up room:', err);
          return interaction.editReply({ content: 'งื้อออ เกิดข้อผิดพลาดในการตั้งค่าห้องเสียงชั่วคราวเมี๊ยว🐾' });
        }
      }
    }
  }

  // Handle Button Click
  if (interaction.isButton()) {
    if (interaction.customId === 'tarot_draw_1') {
      return handleTarotReading(interaction, '1_card');
    }
    if (interaction.customId === 'tarot_draw_3') {
      return handleTarotReading(interaction, '3_cards');
    }

    if (interaction.customId === 'voice_room_create') {
      const guildId = interaction.guild.id;
      const settings = getGuildVoiceSettings(guildId);
      if (!settings) {
        return interaction.reply({ content: 'งื้อออ ยังไม่มีการตั้งค่าระบบห้องเสียงในเซิร์ฟเวอร์นี้เมี๊ยว🐾', ephemeral: true });
      }

      const activeRooms = settings.active_rooms || [];
      const member = interaction.member;

      // 1. Check if user already owns a room
      const userRoom = activeRooms.find(r => r.owner_id === member.id);
      if (userRoom) {
        return interaction.reply({
          content: `งื้อออ คุณมีห้องของคุณอยู่แล้วเมี๊ยว! (<#${userRoom.channel_id}>) สามารถสร้างได้เพียงคนละ 1 ห้องเท่านั้นนะ!`,
          ephemeral: true
        });
      }

      // 2. Check if slots are full
      const maxSlots = settings.max_slots || 10;
      if (activeRooms.length >= maxSlots) {
        return interaction.reply({
          content: `งื้อออ ตอนนี้ห้องเสียงเต็มสล็อตแล้วเมี๊ยว🐾 (สูงสุด ${maxSlots} ห้อง) โปรดรอให้มีคนย้ายออกหรือห้องว่างก่อนนะ!`,
          ephemeral: true
        });
      }

      // 3. Find lowest available slot number (1 to maxSlots)
      let allocatedSlot = 1;
      for (let s = 1; s <= maxSlots; s++) {
        if (!activeRooms.some(r => r.slot_number === s)) {
          allocatedSlot = s;
          break;
        }
      }

      const slotStr = allocatedSlot.toString().padStart(2, '0');

      try {
        await interaction.deferReply({ ephemeral: true });

        // 4. Create voice channel
        const newChannel = await interaction.guild.channels.create({
          name: `〔🔈〕สิงดิส-${slotStr}`,
          type: ChannelType.GuildVoice,
          parent: settings.category_id || null,
          userLimit: 10
        });

        // 5. Save to active rooms
        addActiveRoom(guildId, newChannel.id, member.id, allocatedSlot);

        // 5.5. Send welcome message with owner close button inside voice room text chat
        const welcomeEmbed = new EmbedBuilder()
          .setTitle(`〔🔈〕สิงดิส-${slotStr}`)
          .setDescription(
            `🎉 ยินดีต้อนรับสู่ห้องเสียงชั่วคราวเมี๊ยว!\n\n` +
            `* **ผู้สร้างห้อง**: <@${member.id}>\n` +
            `* **การลบห้องอัตโนมัติ**: หากไม่มีใครอยู่ในห้องเสียงนี้เป็นเวลา 10 นาที ห้องจะถูกลบโดยอัตโนมัติเมี๊ยว🐾`
          )
          .setColor('#5865F2')
          .setTimestamp();

        const welcomeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('voice_room_close')
            .setLabel('ปิดห้องเสียง')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
        );

        await newChannel.send({ embeds: [welcomeEmbed], components: [welcomeRow] }).catch(err => {
          console.error('Failed to send welcome message in voice room:', err);
        });

        // 6. Move user to the channel if they are already in voice
        let movedMsg = '';
        if (member.voice.channel) {
          await member.voice.setChannel(newChannel).catch(() => {});
          movedMsg = ' และได้ดึงคุณเข้าห้องให้แล้วเมี๊ยว!';
        }

        return interaction.editReply({
          content: `🎉 สร้างห้องเรียบร้อยแล้วโดยคุณ <@${member.id}> เมี๊ยว! เชิญเข้าที่ <#${newChannel.id}> ได้เลย!${movedMsg}`
        });
      } catch (err) {
        console.error('Failed to create voice channel via button:', err);
        return interaction.editReply({ content: 'งื้อออ เกิดข้อผิดพลาดในการสร้างห้องเสียงเมี๊ยว🐾' });
      }
    }

    if (interaction.customId === 'voice_room_close') {
      const guildId = interaction.guild.id;
      const settings = getGuildVoiceSettings(guildId);
      if (!settings) {
        return interaction.reply({ content: 'งื้อออ ไม่พบการตั้งค่าระบบห้องเสียงเมี๊ยว🐾', ephemeral: true });
      }

      const activeRooms = settings.active_rooms || [];
      const channelId = interaction.channelId;
      const room = activeRooms.find(r => r.channel_id === channelId);

      if (!room) {
        return interaction.reply({ content: 'งื้อออ ห้องนี้ไม่ใช่ห้องเสียงชั่วคราว หรือห้องถูกลบไปแล้วเมี๊ยว🐾', ephemeral: true });
      }

      // Check if user is the owner
      if (interaction.user.id !== room.owner_id) {
        return interaction.reply({
          content: '❌ เฉพาะเจ้าของห้องเสียงนี้เท่านั้นที่สามารถปิดห้องได้เมี๊ยว🐾',
          ephemeral: true
        });
      }

      try {
        await interaction.reply({ content: 'กำลังทำการปิดและลบห้องเสียงเมี๊ยว🐾', ephemeral: true });
        
        // Clear timers if any
        clearVoiceRoomDeletion(channelId);
        
        // Delete channel
        const channel = interaction.channel;
        if (channel) {
          await channel.delete('เจ้าของห้องปิดห้องเสียง');
        }
        
        // Remove from db
        removeActiveRoom(guildId, channelId);
      } catch (err) {
        console.error('Failed to delete channel by owner button:', err);
      }
    }

    if (interaction.customId === 'staff_ticket_create') {
      const member = interaction.member;
      const hasStaff = member.roles.cache.has(ROLES.STAFF);
      const hasMod = member.roles.cache.has(ROLES.MODERATOR);
      const hasAdmin = member.roles.cache.has(ROLES.ADMIN);
      const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);

      if (!hasStaff && !hasMod && !hasAdmin && !isAdministrator) {
        return interaction.reply({
          content: '❌ เฉพาะทีมงาน (Staff / Moderator / Admin) เท่านั้นที่สามารถเปิด Ticket นี้ได้',
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('staff_ticket_modal')
        .setTitle('เปิด Ticket ถึง Admin');

      const titleInput = new TextInputBuilder()
        .setCustomId('staff_ticket_title')
        .setLabel('หัวข้อเรื่องที่ต้องการส่ง')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ระบุหัวข้อ เช่น ปัญหาบอทขัดข้อง / พบพฤติกรรมผู้เล่นไม่เหมาะสม')
        .setMinLength(5)
        .setMaxLength(100)
        .setRequired(true);

      const descInput = new TextInputBuilder()
        .setCustomId('staff_ticket_desc')
        .setLabel('รายละเอียดเรื่องแบบสั้น')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('กรอกรายละเอียดเรื่องแบบสั้นที่ต้องการรายงาน')
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descInput)
      );

      return interaction.showModal(modal);
    }

    if (interaction.customId === 'staff_ticket_search_trigger' || interaction.customId === 'staff_ticket_search_again') {
      const member = interaction.member;
      const hasStaff = member.roles.cache.has(ROLES.STAFF);
      const hasMod = member.roles.cache.has(ROLES.MODERATOR);
      const hasAdmin = member.roles.cache.has(ROLES.ADMIN);
      const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);

      if (!hasStaff && !hasMod && !hasAdmin && !isAdministrator) {
        return interaction.reply({
          content: '❌ เฉพาะทีมงานเท่านั้นที่สามารถสืบค้นประวัติ Ticket ได้',
          ephemeral: true
        });
      }

      await interaction.reply({
        content: '🔍 **ระบบสืบค้นประวัติ**\nกรุณาพิมพ์หัวข้อ, ผู้เปิด หรือคำที่ต้องการค้นหา ส่งเข้ามาในช่องแชทนี้ได้เลยครับ...',
        ephemeral: true
      });

      const filter = m => m.author.id === interaction.user.id;
      const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

      collector.on('collect', async m => {
        const query = m.content.trim();
        await m.delete().catch(() => {});
        await performTicketSearch(interaction, query, true);
      });
    }

    if (interaction.customId === 'register_discord_link') {
      const modal = new ModalBuilder()
        .setCustomId('register_modal')
        .setTitle('เชื่อมต่อบัญชี PurrPaw');

      const usernameInput = new TextInputBuilder()
        .setCustomId('purrpaw_username')
        .setLabel('กรอก Username ของคุณ (เช่น pp-xxxx)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ตัวอย่าง: pp-username')
        .setMinLength(3)
        .setMaxLength(50)
        .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(usernameInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    }

    if (interaction.customId === 'member_get_role') {
      try {
        const guild = interaction.guild;
        const member = interaction.member;

        const memberRole = guild.roles.cache.get(ROLES.MEMBER);
        const newcomerRole = guild.roles.cache.get(ROLES.NEWCOMER);

        if (!memberRole) {
          return interaction.reply({
            content: '❌ เกิดข้อผิดพลาด: ไม่พบยศ `🎀 | Member` ในเซิร์ฟเวอร์ กรุณาตรวจสอบ Role ID หรือติดต่อแอดมินเพื่อแก้ไข',
            ephemeral: true
          });
        }

        // Check if user already has Member role
        if (member.roles.cache.has(memberRole.id)) {
          return interaction.reply({
            content: '🎀 คุณได้ยืนยันตัวตนและมียศ `🎀 | Member` อยู่แล้วครับ!',
            ephemeral: true
          });
        }

        // Add Member role
        await member.roles.add(memberRole);

        // Remove Newcomer role if they have it
        if (newcomerRole && member.roles.cache.has(newcomerRole.id)) {
          await member.roles.remove(newcomerRole).catch(console.error);
        }

        return interaction.reply({
          content: '🎉 **ยืนยันตัวตนสำเร็จ!** คุณได้รับยศ `🎀 | Member` และเข้าถึงช่องพูดคุยทั้งหมดเรียบร้อยแล้ว ยินดีต้อนรับสู่คอมมูนิตี้ครับ!',
          ephemeral: true
        });

      } catch (err) {
        console.error('Error granting member role:', err);
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({
            content: '❌ เกิดข้อผิดพลาดในการรับยศ สิทธิ์การจัดการบอทอาจไม่เพียงพอ กรุณาลองใหม่อีกครั้งหรือติดต่อแอดมิน',
            ephemeral: true
          });
        }
      }
    }

    if (interaction.customId === 'ticket_create') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const guild = interaction.guild;

        // Find Roles by ID
        const staffRole = guild.roles.cache.get(ROLES.STAFF);
        const modRole = guild.roles.cache.get(ROLES.MODERATOR);
        const adminRole = guild.roles.cache.get(ROLES.ADMIN);
        const activeTicketRole = guild.roles.cache.get(ROLES.ACTIVE_TICKET);

        // Find TICKET category
        const categoryName = '.🛠 ▬▬▬▬ .「 TICKET 」. ▬▬▬▬ ◞ 🐾';
        const category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);

        // Check if user already has an open ticket
        const existingTicket = findTicket(
          t => t.creator_id === interaction.user.id && t.status === 'open' && t.table === 'discord_tickets'
        );

        if (existingTicket) {
          // Verify if channel still exists in Discord cache to prevent stale db states
          const channelExists = guild.channels.cache.has(existingTicket.channel_id);
          if (channelExists) {
            return interaction.editReply({
              content: `❌ คุณมีห้องช่วยเหลือที่เปิดทิ้งไว้อยู่แล้วที่ช่อง <#${existingTicket.channel_id}> กรุณาใช้ห้องดังกล่าวติดต่อ หรือเคลียร์ข้อมูลเดิมก่อนเปิดห้องใหม่ครับ`
            });
          } else {
            // Clean up stale ticket record since the channel was deleted
            upsertTicket(t => t.id === existingTicket.id, { status: 'closed', closed_at: new Date().toISOString() });
          }
        }

        // Assign the active ticket role to the user
        if (activeTicketRole) {
          try {
            await interaction.member.roles.add(activeTicketRole);
          } catch (roleErr) {
            console.error('Failed to assign temporary role to user:', roleErr);
          }
        }

        // Prepare permission overwrites
        const permissionOverwrites = [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          }
        ];

        // Deny view access to other active ticket holders for this specific ticket channel
        if (activeTicketRole) {
          permissionOverwrites.push({
            id: activeTicketRole.id,
            deny: [PermissionFlagsBits.ViewChannel]
          });
        }

        // Allow Staff
        if (staffRole) {
          permissionOverwrites.push({
            id: staffRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          });
        }

        // Allow Moderator
        if (modRole) {
          permissionOverwrites.push({
            id: modRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          });
        }

        // Allow Admin
        if (adminRole) {
          permissionOverwrites.push({
            id: adminRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          });
        }

        // Create the channel options
        const channelOptions = {
          name: `ticket-${interaction.user.username.substring(0, 20)}`,
          type: ChannelType.GuildText,
          permissionOverwrites
        };

        // Put channel under TICKET category if exists
        if (category) {
          channelOptions.parent = category.id;
        }

        // Create the channel
        const channel = await guild.channels.create(channelOptions);

        // Insert ticket to local DB
        const ticketRecord = insertTicket({
          table: 'discord_tickets',
          channel_id: channel.id,
          creator_id: interaction.user.id,
          creator_username: interaction.user.tag,
          status: 'open'
        });

        if (!ticketRecord) {
          await channel.delete().catch(console.error);
          return interaction.editReply({
            content: '❌ ไม่สามารถเริ่มระบบ Ticket ได้เนื่องจากเกิดข้อผิดพลาดในการบันทึกข้อมูล'
          });
        }

        // Welcome message inside the ticket channel
        const welcomeEmbed = new EmbedBuilder()
          .setTitle('🎫 Ticket Support')
          .setDescription(
            `สวัสดีครับ ${interaction.user} ยินดีต้อนรับสู่ช่องติดต่อทีมงาน\n` +
            'กรุณาอธิบายรายละเอียดเรื่องที่ท่านต้องการให้ช่วยเหลือทิ้งไว้ได้เลยครับ\n\n' +
            '**ผู้มีสิทธิ์ปิด Ticket นี้:**\n' +
            `- เจ้าของ Ticket (${interaction.user})\n` +
            '- ทีมงานยศ `🛡️ Staff` หรือระดับที่สูงกว่า\n\n' +
            'หากแก้ไขปัญหาเรียบร้อยแล้ว สามารถกดปุ่ม **"ปิด Ticket"** ด้านล่างได้เลยครับ'
          )
          .setColor('#00ffb7')
          .setTimestamp();

        const welcomeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('ปิด Ticket')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger)
        );

        // Mentioning user and staff/mod/admin
        let pingText = `${interaction.user} | `;
        if (staffRole) pingText += `<@&${staffRole.id}> `;
        if (modRole) pingText += `<@&${modRole.id}> `;
        if (adminRole) pingText += `<@&${adminRole.id}> `;

        await channel.send({
          content: pingText.trim(),
          embeds: [welcomeEmbed],
          components: [welcomeRow]
        });

        return interaction.editReply({
          content: `🎉 สร้างห้องช่วยเหลือของคุณเรียบร้อยแล้วที่ ${channel}`
        });

      } catch (err) {
        console.error('Error creating ticket channel:', err);
        return interaction.editReply({
          content: '❌ เกิดข้อผิดพลาดในการสร้างห้อง Ticket กรุณาลองใหม่อีกครั้ง'
        });
      }
    }

    if (interaction.customId === 'ticket_close') {
      await interaction.deferReply();

      try {
        // Query ticket from database to get the creator
        const ticket = findTicket(
          t => t.channel_id === interaction.channelId && t.status === 'open'
        );

        if (!ticket) {
          return interaction.editReply({
            content: '❌ ไม่พบข้อมูล Ticket นี้ในระบบ หรือ Ticket นี้ถูกปิดไปแล้ว'
          });
        }

        // Check permission: Creator, or Staff / Moderator / Admin roles
        const isCreator = interaction.user.id === ticket.creator_id;
        const member = interaction.member;
        
        const hasStaffRole = member.roles.cache.has(ROLES.STAFF);
        const hasModRole = member.roles.cache.has(ROLES.MODERATOR);
        const hasAdminRole = member.roles.cache.has(ROLES.ADMIN);
        const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isCreator && !hasStaffRole && !hasModRole && !hasAdminRole && !isAdministrator) {
          return interaction.editReply({
            content: '❌ คุณไม่มีสิทธิ์ในการปิด Ticket นี้ เฉพาะเจ้าของเรื่อง หรือทีมงานระดับ 🛡️ Staff ขึ้นไปเท่านั้น'
          });
        }

        // Update status in local DB
        upsertTicket(t => t.id === ticket.id, {
          status: 'closed',
          closed_by: interaction.user.id,
          closed_at: new Date().toISOString()
        });

        // Retrieve and parse all messages in the ticket channel
        let parsedMessages = [];
        try {
          const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
          // Reverse to make it chronological (oldest first)
          const sortedMessages = [...fetchedMessages.values()].reverse();

          for (const msg of sortedMessages) {
            // Skip system messages or bot status posts if you wish, or keep everything
            let images = [];
            if (msg.attachments.size > 0) {
              for (const [_, attachment] of msg.attachments) {
                if (attachment.contentType?.startsWith('image/')) {
                  try {
                    // Download image from Discord CDN
                    const response = await fetch(attachment.url);
                    if (response.ok) {
                      const buffer = Buffer.from(await response.arrayBuffer());
                      const imgDir = path.join(TICKET_LOG_DIR, 'images', interaction.channelId);
                      fs.mkdirSync(imgDir, { recursive: true });
                      const imgFilename = `${msg.id}_${attachment.name}`;
                      const imgFilePath = path.join(imgDir, imgFilename);

                      // Save image to local disk
                      fs.writeFileSync(imgFilePath, buffer);

                      // Store relative path as reference
                      images.push(`TICKET_LOG/images/${interaction.channelId}/${imgFilename}`);
                    }
                  } catch (downloadErr) {
                    console.error(`Failed to save attachment ${attachment.name} locally:`, downloadErr);
                    images.push(attachment.url);
                  }
                }
              }
            }

            parsedMessages.push({
              author_id: msg.author.id,
              author_tag: msg.author.tag,
              timestamp: msg.createdAt.toISOString(),
              content: msg.content,
              images: images
            });
          }
        } catch (fetchErr) {
          console.error('Failed to fetch messages for transcript:', fetchErr);
        }

        // Save JSON transcript to local disk
        let transcriptFilename = '';
        try {
          const transcriptData = {
            ticket_id: ticket.id,
            channel_id: ticket.channel_id,
            creator_id: ticket.creator_id,
            creator_username: ticket.creator_username,
            closed_by: interaction.user.id,
            closed_by_username: interaction.user.tag,
            closed_at: new Date().toISOString(),
            messages: parsedMessages
          };

          transcriptFilename = `ticket-${ticket.channel_id}.json`;
          const jsonFilePath = path.join(TICKET_LOG_DIR, 'transcripts', transcriptFilename);
          fs.writeFileSync(jsonFilePath, JSON.stringify(transcriptData, null, 2), 'utf8');
          console.log(`Transcript saved locally: ${jsonFilePath}`);
        } catch (saveErr) {
          console.error('Failed to save JSON transcript locally:', saveErr);
        }

        // Send to 〔🎟️〕ticket-log channel
        try {
          const logChannelName = '〔🎟️〕ticket-log';
          const logChannel = interaction.guild.channels.cache.find(
            c => c.name === logChannelName || c.name === 'ticket-log'
          );
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('📝 Ticket Logged & Closed')
              .setDescription(
                `**ห้อง Ticket:** \`ticket-${ticket.creator_username}\`\n` +
                `**ผู้เปิด:** <@${ticket.creator_id}> (${ticket.creator_username})\n` +
                `**ผู้ปิด:** ${interaction.user} (${interaction.user.tag})\n` +
                `**ประวัติการสนทนา (JSON):** ${transcriptFilename ? `\`TICKET_LOG/transcripts/${transcriptFilename}\`` : 'บันทึกล้มเหลว'}`
              )
              .setColor('#e74c3c')
              .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (logErr) {
          console.error('Failed to send message to ticket-log channel:', logErr);
        }

        // Remove the active ticket role from the ticket creator
        try {
          const activeTicketRole = interaction.guild.roles.cache.get(ROLES.ACTIVE_TICKET);
          if (activeTicketRole) {
            const creatorMember = await interaction.guild.members.fetch(ticket.creator_id).catch(() => null);
            if (creatorMember) {
              await creatorMember.roles.remove(activeTicketRole);
            }
          }
        } catch (roleErr) {
          console.error('Failed to remove temporary role from user:', roleErr);
        }

        await interaction.editReply({
          content: '🔒 **กำลังเก็บประวัติ อัพโหลดรูปภาพและลบห้องภายใน 10 วินาที...**'
        });

        // Delete channel after 10 seconds
        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (delErr) {
            console.error('Failed to delete channel after ticket close:', delErr);
          }
        }, 10000);

      } catch (err) {
        console.error('Error during ticket close:', err);
        return interaction.editReply({
          content: '❌ เกิดข้อผิดพลาดในการดำเนินการปิด Ticket'
        });
      }
    }

    if (interaction.customId === 'staff_ticket_close') {
      await interaction.deferReply();

      try {
        let ticket = findTicket(
          t => t.channel_id === interaction.channelId && t.status === 'open'
        );

        if (!ticket) {
          return interaction.editReply({
            content: '❌ ไม่พบข้อมูล Staff Ticket นี้ในระบบ หรือ Ticket นี้ถูกปิดไปแล้ว'
          });
        }

        // Check permission: Staff / Moderator / Admin roles
        const member = interaction.member;
        const hasStaffRole = member.roles.cache.has(ROLES.STAFF);
        const hasModRole = member.roles.cache.has(ROLES.MODERATOR);
        const hasAdminRole = member.roles.cache.has(ROLES.ADMIN);
        const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasStaffRole && !hasModRole && !hasAdminRole && !isAdministrator) {
          return interaction.editReply({
            content: '❌ คุณไม่มีสิทธิ์ในการปิด Staff Ticket นี้ เฉพาะทีมงานระดับ Staff ขึ้นไปเท่านั้น'
          });
        }

        // Update status in local DB
        upsertTicket(t => t.id === ticket.id, {
          status: 'closed',
          closed_by: interaction.user.id,
          closed_at: new Date().toISOString()
        });

        // Retrieve and parse all messages in the ticket channel
        let parsedMessages = [];
        try {
          const messages = await interaction.channel.messages.fetch({ limit: 100 });
          const sortedMessages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          
          for (const msg of sortedMessages) {
            let images = [];
            if (msg.attachments.size > 0) {
              for (const [_, attachment] of msg.attachments) {
                if (attachment.contentType?.startsWith('image/')) {
                  try {
                    const response = await fetch(attachment.url);
                    if (response.ok) {
                      const buffer = Buffer.from(await response.arrayBuffer());
                      const imgDir = path.join(TICKET_LOG_DIR, 'images', interaction.channelId);
                      fs.mkdirSync(imgDir, { recursive: true });
                      const imgFilename = `${msg.id}_${attachment.name}`;
                      const imgFilePath = path.join(imgDir, imgFilename);

                      // Save image to local disk
                      fs.writeFileSync(imgFilePath, buffer);

                      // Store relative path as reference
                      images.push(`TICKET_LOG/images/${interaction.channelId}/${imgFilename}`);
                    }
                  } catch (downloadErr) {
                    console.error(`Failed to save staff attachment ${attachment.name} locally:`, downloadErr);
                    images.push(attachment.url);
                  }
                }
              }
            }

            parsedMessages.push({
              author_id: msg.author.id,
              author_tag: msg.author.tag,
              timestamp: msg.createdAt.toISOString(),
              content: msg.content,
              images: images
            });
          }
        } catch (fetchErr) {
          console.error('Failed to fetch messages for staff transcript:', fetchErr);
        }

        // Save JSON transcript to local disk
        let transcriptFilename = '';
        try {
          const transcriptData = {
            ticket_id: ticket.id,
            channel_id: ticket.channel_id,
            creator_id: ticket.creator_id,
            creator_username: ticket.creator_username,
            closed_by: interaction.user.id,
            closed_by_username: interaction.user.tag,
            closed_at: new Date().toISOString(),
            messages: parsedMessages
          };

          transcriptFilename = `staff-ticket-${ticket.channel_id}.json`;
          const jsonFilePath = path.join(TICKET_LOG_DIR, 'transcripts', transcriptFilename);
          fs.writeFileSync(jsonFilePath, JSON.stringify(transcriptData, null, 2), 'utf8');
          console.log(`Staff transcript saved locally: ${jsonFilePath}`);
        } catch (saveErr) {
          console.error('Failed to save staff JSON transcript locally:', saveErr);
        }

        // Send to ticket-log channel
        try {
          const logChannelId = process.env.DISCORD_CHANNEL_STAFF_TICKET_LOG || '1520388745856290916';
          const logChannel = interaction.guild.channels.cache.get(logChannelId) || await interaction.guild.channels.fetch(logChannelId).catch(() => null);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('📝 Staff Ticket Logged & Closed')
              .setDescription(
                `**ห้อง Staff Ticket:** \`${interaction.channel.name}\`\n` +
                `**ผู้เปิด:** <@${ticket.creator_id}> (${ticket.creator_username})\n` +
                `**ผู้ปิด:** ${interaction.user} (${interaction.user.tag})\n` +
                `**ประวัติการสนทนา (JSON):** ${transcriptFilename ? `\`TICKET_LOG/transcripts/${transcriptFilename}\`` : 'บันทึกล้มเหลว'}`
              )
              .setColor('#e67e22')
              .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (logErr) {
          console.error('Failed to send message to ticket-log channel:', logErr);
        }

        // Update Dashboard count (Decrement Open, Increment Closed)
        await updateStaffDashboard(interaction.guild, 'close');

        await interaction.editReply({
          content: '🔒 **Staff Ticket นี้ถูกปิดเรียบร้อยแล้ว**\nห้องแชทนี้จะถูกลบอัตโนมัติภายใน 10 วินาที'
        });

        // Delete thread and parent message after 10 seconds
        setTimeout(async () => {
          try {
            // Delete thread channel directly first
            await interaction.channel.delete().catch(console.error);

            // Fetch and delete parent message from the status channel
            const parentChannelId = process.env.DISCORD_CHANNEL_STAFF_TICKET_STATUS || '1521073164690391220';
            const parentChannel = interaction.guild.channels.cache.get(parentChannelId) || await interaction.guild.channels.fetch(parentChannelId).catch(() => null);
            if (parentChannel) {
              const parentMsg = await parentChannel.messages.fetch(ticket.channel_id).catch(() => null);
              if (parentMsg) {
                await parentMsg.delete().catch(console.error);
              }
            }
          } catch (delErr) {
            console.error('Failed to delete staff thread/message after close:', delErr);
          }
        }, 10000);

      } catch (err) {
        console.error('Error during staff ticket close:', err);
        return interaction.editReply({
          content: '❌ เกิดข้อผิดพลาดในการดำเนินการปิด Staff Ticket'
        });
      }
    }

    if (interaction.customId === 'staff_ticket_draft_cancel') {
      await interaction.reply({ content: '❌ กำลังยกเลิกและลบห้องร่างรายงานนี้...' });
      
      try {
        // Mark draft ticket as cancelled in local DB
        upsertTicket(
          t => t.channel_id === interaction.channelId,
          { status: 'closed', closed_at: new Date().toISOString() }
        );

        setTimeout(async () => {
          await interaction.channel.delete().catch(console.error);
        }, 2000);
      } catch (err) {
        console.error('Failed to cancel draft:', err);
      }
    }

    if (interaction.customId === 'staff_ticket_draft_submit') {
      await interaction.reply({ content: '🚀 กำลังรวบรวมข้อมูลและส่งรายงาน...' });

      try {
        const guild = interaction.guild;

        // Fetch DB Ticket record from local DB
        const ticket = findTicket(t => t.channel_id === interaction.channelId);
        if (!ticket) {
          return interaction.followUp({ content: '❌ ไม่พบข้อมูลร่างรายงานนี้ในระบบ' });
        }

        // Fetch messages to gather images and additional text details
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const sortedMessages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let additionalDetails = [];
        let images = [];
        let draftMessagesLog = [];

        for (const msg of sortedMessages) {
          // Log messages for transcript
          let msgImages = [];
          if (msg.attachments.size > 0) {
            for (const [_, attachment] of msg.attachments) {
              if (attachment.contentType?.startsWith('image/')) {
                try {
                  const response = await fetch(attachment.url);
                  if (response.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const imgDir = path.join(TICKET_LOG_DIR, 'images', interaction.channelId);
                    fs.mkdirSync(imgDir, { recursive: true });
                    const imgFilename = `${msg.id}_${attachment.name}`;
                    fs.writeFileSync(path.join(imgDir, imgFilename), buffer);
                    const localPath = `TICKET_LOG/images/${interaction.channelId}/${imgFilename}`;
                    images.push(localPath);
                    msgImages.push(localPath);
                  }
                } catch (imgErr) {
                  console.error('Failed to save draft attachment locally:', imgErr);
                  msgImages.push(attachment.url);
                  images.push(attachment.url);
                }
              }
            }
          }

          // If the message is from the user (creator) and not the instruction embed
          if (msg.author.id === ticket.creator_id && msg.content && !msg.content.includes('กำลังกรอกข้อมูลรายงาน')) {
            additionalDetails.push(msg.content);
          }

          draftMessagesLog.push({
            author_id: msg.author.id,
            author_tag: msg.author.tag,
            timestamp: msg.createdAt.toISOString(),
            content: msg.content,
            images: msgImages
          });
        }

        // Save JSON transcript of the draft stage to local disk
        let draftTranscriptFilename = '';
        try {
          const draftTranscriptData = {
            stage: 'draft',
            ticket_id: ticket.id,
            creator_id: ticket.creator_id,
            creator_username: ticket.creator_username,
            messages: draftMessagesLog
          };
          draftTranscriptFilename = `draft-ticket-${ticket.channel_id}.json`;
          const jsonFilePath = path.join(TICKET_LOG_DIR, 'transcripts', draftTranscriptFilename);
          fs.writeFileSync(jsonFilePath, JSON.stringify(draftTranscriptData, null, 2), 'utf8');
          console.log(`Draft transcript saved locally: ${jsonFilePath}`);
        } catch (transErr) {
          console.error('Failed to save draft transcript locally:', transErr);
        }

        // Post finalized beautiful Ticket into status channel
        const statusChannelId = process.env.DISCORD_CHANNEL_STAFF_TICKET_STATUS || '1521073164690391220';
        const statusChannel = guild.channels.cache.get(statusChannelId) || await guild.channels.fetch(statusChannelId).catch(() => null);

        if (!statusChannel) {
          return interaction.followUp({ content: '❌ ไม่สามารถส่งเรื่องได้ เนื่องจากไม่พบช่องแสดงผลปลายทาง' });
        }

        const ticketTitle = ticket.title || 'ไม่มีหัวข้อ';
        const ticketDesc = ticket.description || 'ไม่มีรายละเอียด';
        const extraText = additionalDetails.join('\n');

        const finalizedEmbed = new EmbedBuilder()
          .setTitle(`🛠️ Staff Ticket: ${ticketTitle}`)
          .setDescription(
            `**ผู้รายงาน:** <@${ticket.creator_id}> (${ticket.creator_username})\n` +
            `**รายละเอียดเบื้องต้น:**\n${ticketDesc}\n\n` +
            (extraText ? `**ข้อมูลเพิ่มเติม:**\n${extraText}\n` : '')
          )
          .setColor('#e67e22')
          .setTimestamp();

        // Add first image to embed if any
        if (images.length > 0) {
          finalizedEmbed.setImage(images[0]);
        }

        // Add R2 link fields for up to 3 images if any
        if (images.length > 0) {
          const imageLinksText = images.map((url, index) => `[รูปภาพ ${index + 1}](${url})`).join(' | ');
          finalizedEmbed.addFields({ name: '🖼️ แนบไฟล์ภาพ', value: imageLinksText });
        }

        const finalizedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('staff_ticket_close')
            .setLabel('ปิด Staff Ticket')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger)
        );

        // Send to status channel
        const parentMessage = await statusChannel.send({
          content: `🔔 มีเคสจากสตาฟรายงานเข้ามาใหม่!`,
          embeds: [finalizedEmbed],
          components: [finalizedRow]
        });

        // Start a Thread on this message for discussion
        const thread = await parentMessage.startThread({
          name: `staff-${ticketTitle.replace(/[^a-zA-Z0-9ก-๙\s-]/g, '').substring(0, 20) || 'discussion'}`,
          autoArchiveDuration: 1440,
          reason: 'Escalated Staff Ticket Discussion'
        });

        await thread.send({
          content: `ห้องพูดคุยและแก้ไขปัญหาระหว่าง Admin และผู้รายงาน <@${ticket.creator_id}>\n` +
            (draftTranscriptFilename ? `\`TICKET_LOG/transcripts/${draftTranscriptFilename}\`` : '')
        });

        // Update local DB: status to open, update channel_id to Thread ID
        upsertTicket(t => t.channel_id === interaction.channelId, {
          channel_id: thread.id,
          status: 'open'
        });

        // Delete the draft channel
        await interaction.channel.delete().catch(console.error);

        // Update Dashboard count (Increment Open)
        await updateStaffDashboard(guild, 'open');

      } catch (err) {
        console.error('Failed to submit draft:', err);
        return interaction.followUp({ content: '❌ เกิดข้อผิดพลาดในระบบการส่งร่างรายงาน' });
      }
    }

    if (interaction.customId === 'staff_ticket_view_close') {
      await interaction.reply({ content: '🗑️ กำลังลบห้องประวัตินี้ใน 2 วินาที...' });
      setTimeout(async () => {
        await interaction.channel.delete().catch(console.error);
      }, 2000);
    }
  }

  // Handle String Select Menu Click
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'staff_ticket_search_select') {
      const value = interaction.values[0];
      if (value.startsWith('staff_ticket_view:')) {
        const targetChannelId = value.split(':')[1];
        await interaction.deferReply({ ephemeral: true });

        try {
          const guild = interaction.guild;
          
          // 1. Fetch from local DB to find details
          const ticket = findTicket(t => t.channel_id === targetChannelId);
          if (!ticket) {
            return interaction.editReply({ content: '❌ ไม่พบข้อมูลประวัติ Ticket นี้ในระบบ' });
          }

          // 2. Read JSON transcript from local disk
          let transcriptData = null;
          const filesToTry = [
            path.join(TICKET_LOG_DIR, 'transcripts', `staff-ticket-${targetChannelId}.json`),
            path.join(TICKET_LOG_DIR, 'transcripts', `ticket-${targetChannelId}.json`),
            path.join(TICKET_LOG_DIR, 'transcripts', `draft-ticket-${targetChannelId}.json`)
          ];
          for (const filePath of filesToTry) {
            if (fs.existsSync(filePath)) {
              try {
                transcriptData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                break;
              } catch { /* skip */ }
            }
          }

          if (!transcriptData) {
            return interaction.editReply({
              content: '❌ ไม่พบไฟล์ประวัติการคุยในส่วน TICKET_LOG/transcripts/ (อาจไม่มีการคุยเกิดขึ้นหรือยังไม่ได้บันทึก)'
            });
          }

          // 3. Create view-ticket private thread in the status channel
          const statusChannelId = process.env.DISCORD_CHANNEL_STAFF_TICKET_STATUS || '1521073164690391220';
          const statusChannel = guild.channels.cache.get(statusChannelId) || await guild.channels.fetch(statusChannelId).catch(() => null);

          if (!statusChannel) {
            return interaction.editReply({
              content: '❌ ไม่สามารถเปิดดูประวัติได้ เนื่องจากไม่พบช่องแสดงผลปลายทาง'
            });
          }

          const threadName = `view-${ticket.creator_username.replace(/[^a-zA-Z0-9ก-๙]/g, '').substring(0, 15) || 'log'}`;
          const viewChannel = await statusChannel.threads.create({
            name: threadName,
            type: ChannelType.PrivateThread,
            autoArchiveDuration: 60, // 1 hour
            reason: 'View Ticket Log'
          });

          // Add the user who requested it to the private thread
          await viewChannel.members.add(interaction.user.id);

          // 4. Post ticket metadata header
          const metaEmbed = new EmbedBuilder()
            .setTitle(`📖 ประวัติการคุย: ${ticket.title || 'ไม่มีหัวข้อ'}`)
            .setDescription(
              `**ผู้ส่งเรื่อง:** <@${ticket.creator_id}> (${ticket.creator_username})\n` +
              `**สถานะปัจจุบัน:** \`${ticket.status.toUpperCase()}\`\n` +
              `**เปิดเมื่อ:** ${new Date(ticket.created_at).toLocaleString('th-TH')}\n` +
              `**ปิดเมื่อ:** ${ticket.closed_at ? new Date(ticket.closed_at).toLocaleString('th-TH') : 'ไม่ระบุ'}\n\n` +
              `**รายละเอียดตอนส่ง:**\n\`\`\`\n${ticket.description || 'ไม่มีรายละเอียด'}\n\`\`\``
            )
            .setColor('#3498db')
            .setTimestamp();

          const viewCloseRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('staff_ticket_view_close')
              .setLabel('ปิดห้องประวัติ')
              .setEmoji('🗑️')
              .setStyle(ButtonStyle.Danger)
          );

          await viewChannel.send({ embeds: [metaEmbed], components: [viewCloseRow] });

          // 5. Send transcript messages in chunks
          const chatMessages = transcriptData.messages || [];
          if (chatMessages.length === 0) {
            await viewChannel.send({ content: 'ℹ️ *ไม่มีข้อความบันทึกการคุยในห้องนี้*' });
          } else {
            let bufferText = '';
            for (const msg of chatMessages) {
              const dateStr = new Date(msg.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
              let msgLine = `[${dateStr}] **${msg.author_tag}**: ${msg.content || ''}\n`;
              if (msg.images && msg.images.length > 0) {
                msgLine += `> 🖼️ *ไฟล์ภาพแนบ:* ${msg.images.map((url, i) => `[รูปภาพ ${i + 1}](${url})`).join(', ')}\n`;
              }

              if ((bufferText + msgLine).length > 1800) {
                await viewChannel.send({ content: bufferText });
                bufferText = msgLine;
              } else {
                bufferText += msgLine;
              }
            }

            if (bufferText) {
              await viewChannel.send({ content: bufferText });
            }
          }

          // Reply with access link
          return interaction.editReply({
            content: `🎉 สร้างห้องสืบค้นประวัติสำเร็จแล้วที่ <#${viewChannel.id}>`
          });

        } catch (err) {
          console.error('Failed to create ticket view:', err);
          return interaction.editReply({ content: '❌ เกิดข้อผิดพลาดในการสร้างห้องสืบค้นประวัติ' });
        }
      }
    }
  }

  // Handle Modal Submit
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'register_modal') {
      const username = interaction.fields.getTextInputValue('purrpaw_username').trim();

      // Defer reply as ephemeral (only visible to the user)
      await interaction.deferReply({ ephemeral: true });

      try {
        const discordId = interaction.user.id;
        const discordUsername = interaction.user.tag;

        // Call Supabase link_discord RPC
        const { data, error } = await supabase.rpc('link_discord', {
          p_username: username,
          p_discord_id: discordId,
          p_discord_username: discordUsername
        });

        if (error) {
          console.error('Supabase RPC error:', error);
          return interaction.editReply({
            content: `❌ เกิดข้อผิดพลาดจากระบบหลังบ้าน: ${error.message}`
          });
        }

        if (data && data.success) {
          return interaction.editReply({
            content: `🎉 **สำเร็จ!** เชื่อมต่อบัญชีเรียบร้อยแล้ว ได้รับ **150 PAW** ฟรีทันทีในบัญชีของคุณ เรียบร้อย!`
          });
        } else {
          // Handle custom failure codes from RPC
          let errorMsg = 'การเชื่อมต่อไม่สำเร็จ';
          if (data && data.code) {
            switch (data.code) {
              case 'USER_NOT_FOUND':
                errorMsg = '❌ **ไม่พบชื่อผู้ใช้งานนี้!** กรุณาตรวจสอบ Username ในหน้าโปรไฟล์/เติมเงิน อีกครั้ง (ตัวอย่าง: `pp-username`)';
                break;
              case 'ALREADY_LINKED':
                errorMsg = '❌ **ไม่สำเร็จ:** บัญชี PurrPaw นี้ถูกเชื่อมโยงกับบัญชี Discord อื่นไปแล้ว';
                break;
              case 'DISCORD_ALREADY_LINKED':
                errorMsg = '❌ **ไม่สำเร็จ:** บัญชี Discord นี้ถูกเชื่อมโยงกับบัญชี PurrPaw อื่นไปแล้ว';
                break;
              default:
                errorMsg = `❌ **ไม่สำเร็จ:** ${data.message || 'ข้อมูลไม่ถูกต้อง'}`;
            }
          }
          return interaction.editReply({ content: errorMsg });
        }
      } catch (err) {
        console.error('Execution error during registration:', err);
        return interaction.editReply({
          content: '❌ เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้งภายหลัง'
        });
      }
    }

    if (interaction.customId === 'staff_ticket_search_modal') {
      const query = interaction.fields.getTextInputValue('staff_ticket_search_query').trim();
      await performTicketSearch(interaction, query, false);
    }

    if (interaction.customId === 'staff_ticket_modal') {
      const title = interaction.fields.getTextInputValue('staff_ticket_title').trim();
      const description = interaction.fields.getTextInputValue('staff_ticket_desc').trim();

      await interaction.deferReply({ ephemeral: true });

      try {
        const guild = interaction.guild;

        // Find Roles
        const staffRole = guild.roles.cache.get(ROLES.STAFF);
        const modRole = guild.roles.cache.get(ROLES.MODERATOR);
        const adminRole = guild.roles.cache.get(ROLES.ADMIN);

        // Find Staff Category
        const categoryId = process.env.DISCORD_CATEGORY_STAFF_TICKET || '1518532784019472477';
        const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);

        // Check if user already has an open staff ticket
        const existingTicket = findTicket(
          t => t.creator_id === interaction.user.id && (t.status === 'open' || t.status === 'draft')
        );

        if (existingTicket) {
          const channelExists = guild.channels.cache.has(existingTicket.channel_id);
          if (channelExists) {
            const ticketChannel = guild.channels.cache.get(existingTicket.channel_id);
            if (ticketChannel && ticketChannel.parentId === categoryId) {
              return interaction.editReply({
                content: `❌ คุณมีห้อง Staff Ticket ที่เปิดทิ้งไว้อยู่แล้วที่ช่อง <#${existingTicket.channel_id}> กรุณาใช้ห้องดังกล่าวติดต่อ หรือเคลียร์ข้อมูลเดิมก่อนเปิดห้องใหม่ครับ`
              });
            }
          }
        }

        // Create temporary draft text channel under Category
        const cleanTitle = title.replace(/[^a-zA-Z0-9ก-๙\s-]/g, '').replace(/\s+/g, '-').toLowerCase().substring(0, 20);
        const channelName = `draft-${cleanTitle || 'ticket'}-${interaction.user.username.substring(0, 10)}`;

        const permissionOverwrites = [
          {
            id: guild.id, // @everyone role ID
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          }
        ];

        // Allow Staff, Moderator, Admin
        if (staffRole) {
          permissionOverwrites.push({
            id: staffRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          });
        }
        if (modRole) {
          permissionOverwrites.push({
            id: modRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          });
        }
        if (adminRole) {
          permissionOverwrites.push({
            id: adminRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          });
        }

        const channelOptions = {
          name: channelName,
          type: ChannelType.GuildText,
          permissionOverwrites
        };

        if (category) {
          channelOptions.parent = category.id;
        }

        const draftChannel = await guild.channels.create(channelOptions);

        // Save draft to local DB
        const draftRecord = insertTicket({
          table: 'discord_staff_tickets',
          channel_id: draftChannel.id,
          creator_id: interaction.user.id,
          creator_username: interaction.user.tag,
          title: title,
          description: description,
          status: 'draft'
        });

        if (!draftRecord) {
          await draftChannel.delete().catch(console.error);
          return interaction.editReply({
            content: '❌ ไม่สามารถเริ่มระบบ Ticket ได้เนื่องจากเกิดข้อผิดพลาดในการบันทึกข้อมูล'
          });
        }

        // Send Instruction Message inside draft channel
        const draftEmbed = new EmbedBuilder()
          .setTitle('📝 ร่างรายงาน Staff Ticket (Draft)')
          .setDescription(
            `**หัวข้อ:** ${title}\n` +
            `**รายละเอียดแบบสั้น:** ${description}\n\n` +
            '**คำแนะนำเพิ่มเติม:**\n' +
            '1. คุณสามารถพิมพ์ข้อมูลเพิ่มเติม หรืออัปโหลดไฟล์รูปภาพประกอบ (กี่รูปก็ได้) ในช่องแชทนี้ได้เลย\n' +
            '2. เมื่อเตรียมข้อมูลเสร็จแล้ว กดปุ่ม **"ส่ง Ticket"** ด้านล่างเพื่อส่งข้อมูลทั้งหมดเข้าสู่ห้องแสดงผลหลัก\n' +
            '3. หากต้องการยกเลิก กดปุ่ม **"ยกเลิกการส่ง"** เพื่อลบห้องดราฟต์นี้ทิ้งทันที'
          )
          .setColor('#3498db')
          .setTimestamp();

        const draftRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('staff_ticket_draft_submit')
            .setLabel('ส่ง Ticket')
            .setEmoji('🚀')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('staff_ticket_draft_cancel')
            .setLabel('ยกเลิกการส่ง')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
        );

        await draftChannel.send({
          content: `${interaction.user} กำลังกรอกข้อมูลรายงาน...`,
          embeds: [draftEmbed],
          components: [draftRow]
        });

        return interaction.editReply({
          content: `🎉 สร้างห้องเตรียมรายงาน Staff Ticket ของคุณเรียบร้อยแล้วที่ ${draftChannel}`
        });

      } catch (err) {
        console.error('Error creating staff ticket channel:', err);
        return interaction.editReply({
          content: '❌ เกิดข้อผิดพลาดในการสร้างห้อง Staff Ticket กรุณาลองใหม่อีกครั้ง'
        });
      }
    }
  }
});

async function performTicketSearch(interaction, query, isUpdate = false) {
  // Check permission (Only Staff, Mod, Admin can search)
  const member = interaction.member;
  const hasStaff = member.roles.cache.has(ROLES.STAFF);
  const hasMod = member.roles.cache.has(ROLES.MODERATOR);
  const hasAdmin = member.roles.cache.has(ROLES.ADMIN);
  const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);

  if (!hasStaff && !hasMod && !hasAdmin && !isAdministrator) {
    const replyOptions = { content: '❌ เฉพาะทีมงานเท่านั้นที่สามารถสืบค้นประวัติ Ticket ได้', ephemeral: true };
    if (isUpdate) return interaction.followUp(replyOptions);
    return interaction.reply(replyOptions);
  }

  if (!isUpdate) {
    await interaction.deferReply({ ephemeral: true });
  }

  try {
    // Search local tickets DB
    const tickets = searchTickets(query);

    if (!tickets || tickets.length === 0) {
      const responseContent = {
        content: `❌ ไม่พบประวัติ Ticket ที่เกี่ยวข้องกับคำค้นหา: \`${query}\``,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('staff_ticket_search_again')
              .setLabel('ค้นหาอีกครั้ง')
              .setEmoji('🔍')
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      };
      return interaction.editReply(responseContent);
    }

    // Build Dropdown menu
    const options = tickets.map(t => {
      const title = t.title || 'ไม่มีหัวข้อ';
      const label = `[${t.status.toUpperCase()}] ${title.substring(0, 50)}`.substring(0, 100);
      const dateStr = new Date(t.created_at).toLocaleDateString('th-TH');
      
      return {
        label: label,
        description: `ผู้เปิด: ${t.creator_username || 'ไม่ระบุ'} | วันที่: ${dateStr}`,
        value: `staff_ticket_view:${t.channel_id}`
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('staff_ticket_search_select')
      .setPlaceholder('เลือก Ticket ที่ต้องการสืบค้นประวัติ')
      .addOptions(options);

    const searchAgainBtn = new ButtonBuilder()
      .setCustomId('staff_ticket_search_again')
      .setLabel('ค้นหาใหม่ / แก้ไขคำค้น')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);
    const row2 = new ActionRowBuilder().addComponents(searchAgainBtn);

    const responseContent = {
      content: `🔍 พบประวัติ Ticket ทั้งหมด **${tickets.length}** เคสที่เกี่ยวข้องกับ: \`${query}\` กรุณาเลือกเคสที่ต้องการดูด้านล่าง:`,
      components: [row1, row2]
    };

    return interaction.editReply(responseContent);

  } catch (err) {
    console.error('Failed to search tickets:', err);
    const errorContent = { content: '❌ เกิดข้อผิดพลาดในการสืบค้นประวัติในฐานข้อมูล' };
    return interaction.editReply(errorContent);
  }
}

async function updateStaffDashboard(guild, action) {
  const setupChannelId = process.env.DISCORD_CHANNEL_STAFF_TICKET_SETUP || '1520388745856290916';
  const setupChannel = guild.channels.cache.get(setupChannelId) || await guild.channels.fetch(setupChannelId).catch(() => null);
  if (!setupChannel) return;

  try {
    const messages = await setupChannel.messages.fetch({ limit: 50 });
    const setupMessage = messages.find(m => m.author.id === guild.client.user.id && m.embeds[0]?.title === '🛠️ ระบบส่งเรื่องติดต่อแอดมิน (Staff Escalation)');
    if (setupMessage) {
      const oldEmbed = setupMessage.embeds[0];
      const description = oldEmbed.description || '';

      const openMatch = description.match(/🟢\s*เปิด\s*:\s*(\d+)/);
      const closedMatch = description.match(/🔴\s*ปิด\s*:\s*(\d+)/);
      let openCount = openMatch ? parseInt(openMatch[1], 10) : 0;
      let closedCount = closedMatch ? parseInt(closedMatch[1], 10) : 0;

      if (action === 'open') {
        openCount++;
      } else if (action === 'close') {
        if (openCount > 0) openCount--;
        closedCount++;
      }

      const newEmbed = EmbedBuilder.from(oldEmbed)
        .setDescription(
          'ช่องทางติดต่อสำหรับ Staff, Moderator และ Admin เพื่อส่งเรื่องช่วยเหลือหรือแจ้งปัญหาเฉพาะกิจ\n\n' +
          '**สถานะ Ticket**\n' +
          `🟢 เปิด : ${openCount}\n` +
          `🔴 ปิด : ${closedCount}`
        );

      await setupMessage.edit({ embeds: [newEmbed] });

      // Update status channel name if it exists in env
      const statusChannelId = process.env.DISCORD_CHANNEL_STAFF_TICKET_STATUS;
      if (statusChannelId) {
        const statusChannel = guild.channels.cache.get(statusChannelId) || await guild.channels.fetch(statusChannelId).catch(() => null);
        if (statusChannel) {
          await statusChannel.setName(`〔🟢〕•staff-ticket-${openCount}`).catch(err => {
            console.error('Failed to update status channel name:', err);
          });
        }
      }
    }
  } catch (err) {
    console.error('Failed to update staff dashboard:', err);
  }
}

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = newState.guild.id;
  if (guildId !== process.env.ALLOWED_GUILD_ID) return;

  const settings = getGuildVoiceSettings(guildId);
  if (!settings) return;

  const activeRooms = settings.active_rooms || [];

  // Case 2: Member left a channel (check if it was an active dynamic room and is now empty)
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const isDynamicRoom = activeRooms.some(r => r.channel_id === oldState.channelId);
    if (isDynamicRoom) {
      const oldChannel = oldState.channel;
      if (oldChannel && oldChannel.members.size === 0) {
        scheduleVoiceRoomDeletion(guildId, oldState.channelId);
      }
    }
  }

  // Case 3: Member joined a dynamic channel that was about to be deleted -> Cancel timer
  if (newState.channelId && oldState.channelId !== newState.channelId) {
    const isDynamicRoom = activeRooms.some(r => r.channel_id === newState.channelId);
    if (isDynamicRoom) {
      clearVoiceRoomDeletion(newState.channelId);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);