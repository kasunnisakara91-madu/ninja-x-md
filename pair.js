const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require('yt-search');
const FileType = require('file-type');
const { MongoClient } = require('mongodb');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const {
    default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// ==================== CONFIG ====================

const BOT_NAME_FANCY = '𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'false',
  AUTO_LIKE_EMOJI: ['💙', '🩷', '💜', '🤎', '🧡', '🩵', '💛', '🩶', '♥️', '💗', '❤️‍🔥'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/G7qafxv7mGrH3LVGuDMUHw',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/0kk9yl.jpeg',
  NEWSLETTER_JID: [
      '120363407179960904@newsletter', // Dula OFC DEV 1
      '120363418906972955@newsletter', // DULA OFC DEV
      '120363421785026867@newsletter',//MADUSANKA OFC DEV 1
      '120363423916773660@newsletter',//MADUSANKA OFC DEV 2
      '120363348739987203@newsletter'//Arslan-MD Official
      ],
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER.split(',') : ['94752978237', '94743387798'],
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBivQGBKfi1VaWyEd0t',
  BOT_NAME: '© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳',
  BOT_VERSION: '3.0.0 ULTRA',
  OWNER_NAME: '@𝘿𝙘𝙩 𝘿𝙪𝙡𝙖 𝘿𝙚𝙫',
  IMAGE_PATH: 'https://files.catbox.moe/0kk9yl.jpeg',
  BOT_FOOTER: '> *© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳*',
  
  // Default settings values
  DEFAULT_SETTINGS: {
    WORK_TYPE: 'public',
    AUTO_VIEW_STATUS: 'true',
    AUTO_REPLY: 'true',
    AUTO_VOICE: 'on',
    AUTO_STICKER: 'false',
    ANTI_BAD: 'false',
    ANTI_LINK: 'false',
    ANTI_BOT: 'false',
    PRESENCE: 'online',
    READ_COMMAND: 'true',
    AUTO_RECORDING: 'false',
    AUTO_TYPING: 'false',
    AUTO_LIKE_STATUS: 'true',
    BAD_NO_BLOCK: 'false',
    AI_CHAT: 'true',
    ANTI_CALL: 'off',
    WELCOME_GOODBYE: 'false',
    ANTI_DELETE: 'off',
    AUTO_TIKTOK: 'false',
    AUTO_NEWS: 'false',
    AUTO_REPLY_MODE: 'default',
    MOVIE_MODE: 'public'
  }
};

// ==================== MONGO SETUP ====================

// Config cache to avoid repeated database queries
const configCache = new Map();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://dct-dula:dct-ninja-x-md@dctninja.gxfynay.mongodb.net/?appName=dctninja';
const MONGO_DB = process.env.MONGO_DB || 'DCT_NINJA_DBX';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;
let mongoInitialized = false;
let mongoInitPromise = null;

async function initMongo() {
  if (mongoInitialized && mongoClient) return;
  if (mongoInitPromise) return mongoInitPromise;
  
  mongoInitPromise = (async () => {
    try {
      if (mongoClient?.topology?.isConnected) return;
    } catch (e) { }
    
    mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, maxPoolSize: 10 });
    await mongoClient.connect();
    mongoDB = mongoClient.db(MONGO_DB);

    sessionsCol = mongoDB.collection('sessions');
    numbersCol = mongoDB.collection('numbers');
    adminsCol = mongoDB.collection('admins');
    newsletterCol = mongoDB.collection('newsletter_list');
    configsCol = mongoDB.collection('configs');
    newsletterReactsCol = mongoDB.collection('newsletter_reacts');

    await Promise.all([
      sessionsCol.createIndex({ number: 1 }, { unique: true }),
      numbersCol.createIndex({ number: 1 }, { unique: true }),
      newsletterCol.createIndex({ jid: 1 }, { unique: true }),
      newsletterReactsCol.createIndex({ jid: 1 }, { unique: true }),
      configsCol.createIndex({ number: 1 }, { unique: true })
    ]);
    
    mongoInitialized = true;
    console.log('✅ Mongo initialized and collections ready');
  })();
  
  return mongoInitPromise;
}

// ==================== Mongo Helpers ====================

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    if (!sessionsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    if (!sessionsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    if (!sessionsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeSessionFromMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    if (!numbersCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    if (!numbersCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    if (!numbersCol || !mongoInitialized) await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    if (!adminsCol || !mongoInitialized) await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    if (!adminsCol || !mongoInitialized) await initMongo();
    const doc = { jid: jidOrNumber };
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    if (!adminsCol || !mongoInitialized) await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    if (!newsletterCol || !mongoInitialized) await initMongo();
    const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
    await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    if (!newsletterCol || !mongoInitialized) await initMongo();
    await newsletterCol.deleteOne({ jid });
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    if (!newsletterCol || !mongoInitialized) await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    if (!mongoDB || !mongoInitialized) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    await col.insertOne(doc);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    if (!configsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
    // Invalidate cache
    configCache.delete(sanitized);
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    const sanitized = number.replace(/[^0-9]/g, '');
    
    // Check cache first
    const cached = configCache.get(sanitized);
    if (cached && Date.now() - cached.time < CONFIG_CACHE_TTL) {
      return cached.config;
    }
    
    if (!configsCol || !mongoInitialized) await initMongo();
    const doc = await configsCol.findOne({ number: sanitized });
    const userConfig = doc ? doc.config : {};
    const result = { ...config.DEFAULT_SETTINGS, ...userConfig };
    
    // Cache the result
    configCache.set(sanitized, { config: result, time: Date.now() });
    return result;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return { ...config.DEFAULT_SETTINGS }; }
}

// ==================== Basic Utils ====================

function formatMessage(title, content, footer) {
  return `${title}\n\n${content}\n\n> *${footer}*`;
}
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp() { return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// ==================== Helpers ====================

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `*📞 𝗡ᴜᴍʙᴇʀ:* ${number}\n*🍁 𝗦ᴛᴀᴛᴜꜱ:* ${groupStatus}\n*🕒 𝗖ᴏɴɴᴇᴄᴛᴇᴅ 𝗔ᴛ:* ${getSriLankaTimestamp()}`, botName);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      if (String(image).startsWith('http')) {
        await socket.sendMessage(to, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(to, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  try {
    const ownerNumbers = config.OWNER_NUMBER.map(num => `${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
    const activeCount = activeSockets.size;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
    const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(`*🥷 𝗢ᴡɴᴇʀ 𝗖ᴏɴᴛᴀᴄᴛ: ${botName}*`, 
      `*📞 𝗡ᴜᴍʙᴇʀ:* ${number}\n*🍁 𝗦ᴛᴀᴛᴜꜱ:* ${groupStatus}\n*🕒 𝗖ᴏɴɴᴇᴄᴛᴇᴅ 𝗔ᴛ:* ${getSriLankaTimestamp()}\n\n*🔢 𝗔ᴄᴛɪᴠᴇ 𝗦ᴇꜱꜱɪᴏɴꜱ:* ${activeCount}`, 
      botName);

    for (const ownerJid of ownerNumbers) {
      if (String(image).startsWith('http')) {
        await socket.sendMessage(ownerJid, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(ownerJid, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    }
  } catch (err) { console.error('Failed to send owner connect message:', err); }
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`*🔐 𝐎𝚃𝙿 𝐕𝙴𝚁𝙸𝙵𝙸𝙲𝙰𝚃𝙸𝙾𝙽 — ${BOT_NAME_FANCY}*`, `*𝐘𝙾𝚄𝚁 𝐎𝚃𝙿 𝐅𝙾𝚁 𝐂𝙾𝙽𝙵𝙸𝙶 𝐔𝙿𝙳𝙰𝚃𝙴 𝐈𝚂:* *${otp}*\n𝐓𝙷𝙸𝚂 𝐎𝚃𝙿 𝐖𝙸𝙻𝙻 𝐄𝚇𝙿𝙸𝚁𝙴 𝐈𝙽 5 𝐌𝙸𝙽𝚄𝚃𝙴𝚂.\n\n*𝐍𝚄𝙼𝙱𝙴𝚁:* ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ==================== Handlers ====================

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo();
      const reactConfigs = await listNewsletterReactsFromMongo();
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedMap = new Map(followedDocs.map(d => [d.jid, d]));
      if (!followedMap.has(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedMap.has(jid)) {
        emojis = (followedMap.get(jid).emojis || []);
      }
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}

async function setupStatusHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

    try {
      let userEmojis = config.AUTO_LIKE_EMOJI;
      let autoViewStatus = config.AUTO_VIEW_STATUS;
      let autoLikeStatus = config.AUTO_LIKE_STATUS;
      let autoRecording = config.AUTO_RECORDING;

      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};

        if (userConfig.AUTO_LIKE_EMOJI && Array.isArray(userConfig.AUTO_LIKE_EMOJI) && userConfig.AUTO_LIKE_EMOJI.length > 0) {
          userEmojis = userConfig.AUTO_LIKE_EMOJI;
        }
        if (userConfig.AUTO_VIEW_STATUS !== undefined) autoViewStatus = userConfig.AUTO_VIEW_STATUS;
        if (userConfig.AUTO_LIKE_STATUS !== undefined) autoLikeStatus = userConfig.AUTO_LIKE_STATUS;
        if (userConfig.AUTO_RECORDING !== undefined) autoRecording = userConfig.AUTO_RECORDING;
      }

      if (autoRecording === 'true') {
        await socket.sendPresenceUpdate("recording", message.key.remoteJid);
      }

      if (autoViewStatus === 'true') {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.readMessages([message.key]);
            break;
          } catch (error) {
            retries--;
            await delay(1000 * (config.MAX_RETRIES - retries));
            if (retries === 0) throw error;
          }
        }
      }

      if (autoLikeStatus === 'true') {
        const randomEmoji = userEmojis[Math.floor(Math.random() * userEmojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, {
              react: { text: randomEmoji, key: message.key }
            }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) {
            retries--;
            await delay(1000 * (config.MAX_RETRIES - retries));
            if (retries === 0) throw error;
          }
        }
      }

    } catch (error) {
      console.error('Status handler error:', error);
    }
  });
}

async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    const mode = userConfig.ANTI_DELETE || 'off';
    if (mode === 'off') return;

    const isGroup = String(messageKey.remoteJid || '').endsWith('@g.us');
    if (mode === 'inbox' && isGroup) return;
    if (mode === 'group' && !isGroup) return;

    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('*🗑️ 𝗠ᴇꜱꜱᴀɢᴇ 𝗗ᴇʟᴇᴛᴇᴅ*', `A message was deleted from your chat.\n*📋 𝗙ʀᴏᴍ:* ${messageKey.remoteJid}\n*🍁 𝗗ᴇʟᴇᴛɪᴏɴ 𝗧ɪᴍᴇ:* ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}

async function setupWelcomeGoodbye(socket, sessionNumber) {
  socket.ev.on('group-participants.update', async (update) => {
    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.WELCOME_GOODBYE !== 'true') return;

      const groupId = update.id;
      const participants = update.participants || [];
      if (!participants.length) return;

      try {
        const groupMetadata = await socket.groupMetadata(groupId);
        const groupName = groupMetadata?.subject || "Our Group";
        const memberCount = groupMetadata?.participants?.length || 0;

        for (const participant of participants) {
          const userId = participant.split('@')[0];

          if (update.action === 'add') {
            const welcomeMsg = `
╭━━━〔 🌟 W E L C O M E 🌟 〕━━━⬣

👋 Hey *@${userId}* ✨
🎉 Welcome to *${groupName}*

╭━━━〔 💎 GROUP INFO 〕━━━⬣
┃ 👥 Members : ${memberCount}
┃ 🏷️ Status : New Member
╰━━━━━━━━━━━━━━⬣

╭━━━〔 📌 RULES 〕━━━⬣
┃ 🔹 Be respectful 🤝
┃ 🔹 No spam 🚫
┃ 🔹 Enjoy & stay active 💬
╰━━━━━━━━━━━━━━⬣

╭━━━〔 🌈 MESSAGE 〕━━━⬣
┃ 💖 We're happy to have you here!
┃ 🚀 Hope you enjoy your stay
╰━━━━━━━━━━━━━━⬣

╭━━━〔 ✨ ENJOY ✨ 〕━━━⬣
╰━━━━━━━━━━━━━━⬣
`;
            await socket.sendMessage(groupId, {
              image: { url: userConfig.logo || config.RCD_IMAGE_PATH },
              caption: welcomeMsg,
              mentions: [participant]
            });
          } else if (update.action === 'remove') {
            const goodbyeMsg = `
╭━━━〔 🌙 G O O D B Y E 🌙 〕━━━⬣

👋 Bye *@${userId}* 💔
🚪 You left *${groupName}*

╭━━━〔 📊 GROUP STATUS 〕━━━⬣
┃ 👥 Members Left : ${memberCount - 1}
┃ 🏷️ Status : Left Group
╰━━━━━━━━━━━━━━⬣

╭━━━〔 💔 MESSAGE 〕━━━⬣
┃ 😢 You will be missed here
┃ 🤍 Doors always open for you
╰━━━━━━━━━━━━━━⬣

╭━━━〔 🌌 TAKE CARE 🌌 〕━━━⬣
┃ 🌟 Stay safe & happy
┃ 💫 Hope to see you again
╰━━━━━━━━━━━━━━⬣
`;
            await socket.sendMessage(groupId, {
              image: { url: userConfig.logo || config.RCD_IMAGE_PATH },
              caption: goodbyeMsg,
              mentions: [participant]
            });
          }
        }
      } catch (metaErr) {
        console.error('Failed to get group metadata:', metaErr);
      }
    } catch (err) {
      console.error('WelcomeGoodbye error:', err);
    }
  });
}

async function setupCallRejection(socket, sessionNumber) {
  socket.ev.on('call', async (calls) => {
    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.ANTI_CALL !== 'on') return;

      for (const call of calls) {
        if (call.status !== 'offer') continue;
        const id = call.id;
        const from = call.from;
        await socket.rejectCall(id, from);
        await socket.sendMessage(from, { text: '*🔕 Auto call rejection is enabled. Calls are automatically rejected.*' });
        const userJid = jidNormalizedUser(socket.user.id);
        const rejectionMessage = formatMessage('📞 CALL REJECTED', `Auto call rejection is active.\n\nCall from: ${from}\nTime: ${getSriLankaTimestamp()}`, BOT_NAME_FANCY);
        await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: rejectionMessage });
      }
    } catch (err) {
      console.error(`Call rejection error for ${sessionNumber}:`, err);
    }
  });
}

async function setupAutoMessageRead(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    const autoReadSetting = userConfig.READ_COMMAND || 'false';

    if (autoReadSetting !== 'true') return;

    let body = '';
    try {
      const type = getContentType(msg.message);
      const actualMsg = (type === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

      if (type === 'conversation') body = actualMsg.conversation || '';
      else if (type === 'extendedTextMessage') body = actualMsg.extendedTextMessage?.text || '';
    } catch (e) { body = ''; }

    const prefix = userConfig.PREFIX || config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);

    if (isCmd) {
      try { await socket.readMessages([msg.key]); } catch (error) { console.warn('Failed to read command message:', error?.message); }
    }
  });
}

async function setupMessageHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    try {
      let autoTyping = false;
      let autoRecording = false;

      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
        if (userConfig.AUTO_TYPING === 'true') autoTyping = true;
        if (userConfig.AUTO_RECORDING === 'true') autoRecording = true;
      }

      if (autoTyping) {
        try {
          await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
          setTimeout(async () => { try { await socket.sendPresenceUpdate('paused', msg.key.remoteJid); } catch (e) { } }, 3000);
        } catch (e) { console.error('Auto typing error:', e); }
      }

      if (autoRecording) {
        try {
          await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
          setTimeout(async () => { try { await socket.sendPresenceUpdate('paused', msg.key.remoteJid); } catch (e) { } }, 3000);
        } catch (e) { console.error('Auto recording error:', e); }
      }
    } catch (error) {
      console.error('Message handler error:', error);
    }
  });
}

// ==================== Cleanup Helper ====================

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch (e) { }
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch (e) { }
    try { await removeNumberFromMongo(sanitized); } catch (e) { }
    try {
      const ownerNumbers = config.OWNER_NUMBER.map(num => `${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
      const caption = formatMessage('*🥷 OWNER NOTICE — SESSION REMOVED*', `*𝐍umber:* ${sanitized}\n*𝐒ession 𝐑emoved 𝐃ue 𝐓o 𝐋ogout.*\n\n*𝐀ctive 𝐒essions 𝐍ow:* ${activeSockets.size}`, BOT_NAME_FANCY);
      for (const ownerJid of ownerNumbers) {
        if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
      }
    } catch (e) { }
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ==================== Auto-Restart ====================

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
        || lastDisconnect?.error?.statusCode
        || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
        || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
        || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
        || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch (e) { console.error(e); }
      } else {
        console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g, '')); socketCreationTime.delete(number.replace(/[^0-9]/g, '')); const mockRes = { headersSent: false, send: () => { }, status: () => mockRes }; await EmpirePair(number, mockRes); } catch (e) { console.error('Reconnect attempt failed', e); }
      }
    }
  });
}

// ==================== EmpirePair ====================

async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  if (!mongoInitialized) await initMongo().catch(() => { });

  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  try {
    const { default: makeWASocket, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");

const { version } = await fetchLatestBaileysVersion();

const socket = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    // ⚠️ "Ubuntu / Chrome / 22.04" is the default fingerprint copy-pasted across
    // thousands of public bot repos, which makes it an easy signature to flag.
    // Using a less common desktop fingerprint reduces (does not eliminate) that risk.
    browser: ["Windows", "Edge", "120.0.0.0"],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false
});


    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket, sanitizedNumber);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket, sanitizedNumber);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);
    setupWelcomeGoodbye(socket, sanitizedNumber);
    setupAutoMessageRead(socket, sanitizedNumber);
    setupCallRejection(socket, sanitizedNumber);

    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000 * (config.MAX_RETRIES - retries)); }
      }
      if (!res.headersSent) res.send({ code });
    }

    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const credsPath = path.join(sessionPath, 'creds.json');
        if (!fs.existsSync(credsPath)) return;
        const fileStats = fs.statSync(credsPath);
        if (fileStats.size === 0) return;
        const fileContent = await fs.readFile(credsPath, 'utf8');
        const trimmedContent = fileContent.trim();
        if (!trimmedContent || trimmedContent === '{}' || trimmedContent === 'null') return;
        let credsObj;
        try { credsObj = JSON.parse(trimmedContent); } catch (e) { return; }
        if (!credsObj || typeof credsObj !== 'object') return;
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
        console.log('✅ Creds saved to MongoDB successfully');
      } catch (err) {
        console.error('Failed saving creds on creds.update:', err);
      }
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(() => ({ status: 'failed', error: 'joinGroup not configured' }));

          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch (e) { }
            }
          } catch (e) { }

          activeSockets.set(sanitizedNumber, socket);
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          const initialCaption = formatMessage(useBotName,
            `*✅ 𝗦ᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ 𝗖ᴏɴɴᴇᴄᴛᴇᴅ ✅*\n\n*🔢 𝗡ᴜᴍʙᴇʀ :* ${sanitizedNumber}\n*📡 𝗖ᴏɴɴᴇᴄᴛɪɴɢ :* Wait few seconds`,
            useBotName
          );

          let sentMsg = null;
          try {
            if (String(useLogo).startsWith('http')) {
              sentMsg = await socket.sendMessage(userJid, { image: { url: useLogo }, caption: initialCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                sentMsg = await socket.sendMessage(userJid, { image: buf, caption: initialCaption });
              } catch (e) {
                sentMsg = await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: initialCaption });
              }
            }
          } catch (e) {
            try { sentMsg = await socket.sendMessage(userJid, { text: initialCaption }); } catch (e) { }
          }

          await delay(4000);

          const updatedCaption = formatMessage(
  useBotName,
  `╭━━━〔 ✅ 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗘𝗗 〕━━━╮

┃ 🔢 𝗡𝘂𝗺𝗯𝗲𝗿   : ${sanitizedNumber}
┃ 🏷️ 𝗦𝘁𝗮𝘁𝘂𝘀   : ${groupStatus}
┃ 🕒 𝗧𝗶𝗺𝗲     : ${getSriLankaTimestamp()}

╰━━━━━━━━━━━━━━━━━━━━━━╯

✨ 𝗦𝘆𝘀𝘁𝗲𝗺 𝗶𝘀 𝗻𝗼𝘄 𝗼𝗻𝗹𝗶𝗻𝗲 & 𝗿𝗲𝗮𝗱𝘆!`,
  useBotName
);

          try {
            if (sentMsg && sentMsg.key) {
              try { await socket.sendMessage(userJid, { delete: sentMsg.key }); } catch (delErr) { }
            }
            try {
              if (String(useLogo).startsWith('http')) {
                await socket.sendMessage(userJid, { image: { url: useLogo }, caption: updatedCaption });
              } else {
                try {
                  const buf = fs.readFileSync(useLogo);
                  await socket.sendMessage(userJid, { image: buf, caption: updatedCaption });
                } catch (e) {
                  await socket.sendMessage(userJid, { text: updatedCaption });
                }
              }
            } catch (imgErr) {
              await socket.sendMessage(userJid, { text: updatedCaption });
            }
          } catch (e) { }

          await sendAdminConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await sendOwnerConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await addNumberToMongo(sanitizedNumber);

          await socket.sendMessage(userJid, { text: `✅ *${useBotName} is now online!*\n\nType *${config.PREFIX}menu* to see all available commands.\n\n_Thank you for using DCT Ninja X MD!_` });

        } catch (e) {
          console.error('Connection open error:', e);
          try { exec(`pm2.restart ${process.env.PM2_NAME || 'DCT-NINJA-MD'}`); } catch (e) { }
        }
      }
      if (connection === 'close') {
        try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch (e) { }
      }
    });

    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }
}

// ==================== COMPLETE COMMAND HANDLER WITH CASE TYPE ====================

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message) return;
    
    if (msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    try {
      let body = '';
      const msgType = getContentType(msg.message);
      
      if (msgType === 'conversation') body = msg.message.conversation || '';
      else if (msgType === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
      else if (msgType === 'imageMessage') body = msg.message.imageMessage?.caption || '';
      else if (msgType === 'videoMessage') body = msg.message.videoMessage?.caption || '';
      else if (msgType === 'buttonsResponseMessage') body = msg.message.buttonsResponseMessage?.selectedButtonId || '';
      else if (msgType === 'listResponseMessage') body = msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || '';

      if (!body || typeof body !== 'string') return;
      
      const prefix = config.PREFIX;
      let fullCommand = '';
      if (body.startsWith(prefix)) {
        fullCommand = body.slice(prefix.length).trim();
      } else if (/^[0-9]+$/.test(body.trim())) {
        fullCommand = body.trim();
      } else {
        return;
      }
      const command = fullCommand.split(' ')[0].toLowerCase();
      const args = fullCommand.slice(command.length).trim().split(/\s+/).filter(Boolean);
      
      const from = msg.key.remoteJid;
      const sender = from;
      const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
      const senderNumber = (nowsender || '').split('@')[0];
      const isOwner = config.OWNER_NUMBER.some(owner => senderNumber === owner.replace(/[^0-9]/g, ''));
      const isGroup = from.endsWith("@g.us");
      
      const sanitized = (number || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};

      // Work type restrictions
      if (!isOwner) {
        const workType = userConfig.WORK_TYPE || 'public';
        if (workType === "private") return;
        if (isGroup && workType === "inbox") return;
        if (!isGroup && workType === "groups") return;
      }

      console.log(`📨 Command: ${command} from ${senderNumber}`);

      // ==================== AUTO VOICE FEATURE ====================
      try {
        const _sanitizedAV = (senderNumber || '').replace(/[^0-9]/g, '');
        const _userConfigAV = await loadUserConfigFromMongo(_sanitizedAV) || {};
        const _autoVoiceEnabled = _userConfigAV.AUTO_VOICE !== 'off';

        const _bodyLowerV = (body || '').trim().toLowerCase();

        // 🎧 FIXED VOICE MAP
        const _voiceReplies = {
          // 🌅 greetings
          'gm': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/gm.ogg',
          'good morning': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/gm.ogg',

          'gn': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/gn.mp3',
          'good night': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/good%20night.mp3',

          // 💬 chat
          'hi': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
          'hey': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
          'hello': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
          'helo': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
          'hy': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',

          'bye': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bye%20lassana%20lamayo.ogg',
          'hm': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bye%20lassana%20lamayo.ogg',

          // 🇱🇰 sinhala
          'mk': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/mk.ogg',
          'mokada karanne': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/mk.ogg',

          // ❤️ love
          'adareyi': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
          'ආදරෙයි': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
          'love you': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
          'i love you': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',

          // 😂 reactions
          'ha ha': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/hako.mp3',
          'hako': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/hako.mp3',

          // 🤖 bot
          'bot': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',

          // ❗ bad words (split fixed)
          'hutta': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'pakaya': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'ponnaya': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'utta': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'ponz': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'wesigeputha': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'huttigeputha': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'huththa': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
          'huththigeputha': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg'
        };

        if (_autoVoiceEnabled && _voiceReplies[_bodyLowerV]) {
          try {
            const voiceUrl = _voiceReplies[_bodyLowerV];
            const voiceResponse = await axios.get(voiceUrl, { responseType: 'arraybuffer' });
            const voiceBuffer = Buffer.from(voiceResponse.data);

            await socket.sendMessage(sender, {
              audio: voiceBuffer,
              mimetype: 'audio/ogg; codecs=opus',
              ptt: true
            }, { quoted: msg });

            console.log(`🎵 Auto voice sent for: ${_bodyLowerV}`);
          } catch (voiceError) {
            console.error('Auto voice error:', voiceError);
          }
        }
      } catch (autoVoiceError) {
        console.error('Auto voice feature error:', autoVoiceError);
      }

      // Helper for quoted media
      async function downloadQuotedMedia(quoted) {
        if (!quoted) return null;
        const qTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
        const qType = qTypes.find(t => quoted[t]);
        if (!qType) return null;
        const messageType = qType.replace(/Message$/i, '').toLowerCase();
        const stream = await downloadContentFromMessage(quoted[qType], messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return { buffer, mime: quoted[qType].mimetype || '', caption: quoted[qType].caption || quoted[qType].fileName || '', ptt: quoted[qType].ptt || false, fileName: quoted[qType].fileName || '' };
      }

      // ==================== CASE TYPE COMMAND HANDLER ====================
      
      // Helper function to extract channel ID from WhatsApp channel link
      function extractChannelId(link) {
        if (!link) return null;
        
        // Handle different WhatsApp channel link formats
        const patterns = [
          /https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([0-9]+)/i,
          /https?:\/\/chat\.whatsapp\.com\/channel\/([0-9]+)/i,
          /wa\.me\/channel\/([0-9]+)/i,
          /channel\/([0-9]+)/i,
          /([0-9]+)@newsletter/i
        ];
        
        for (const pattern of patterns) {
          const match = link.match(pattern);
          if (match && match[1]) {
            return `${match[1]}@newsletter`;
          }
        }
        
        // If it's already a JID format
        if (link.includes('@newsletter')) {
          return link;
        }
        
        return null;
      }
      
      switch(command) {
              case 'baiscope':             
case 'bs': {
    const DEFAULT_FOOTER = `\n\n> 🎭 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳 🎭\n> 🧬 ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text: `*❪ ERROR ❫*\n\n⚠️ *Invalid Usage!*\n\n🎬 *Example:*
• .baiscope iron man
• .bs dark knight\n\n📝 _Please provide the Movie_ _or TV Series name!_${DEFAULT_FOOTER}`
        }, { quoted: msg });
        break;
    }

    const query = args.join(' ');
    await socket.sendMessage(sender, { 
        text: `*❪ SEARCHING ❫*\n\n🔍 *Searching Baiscope...*\n⚡ _Please wait a moment._`
    });

    const API_BASE = "https://chama-movie-api.koyeb.app";
    const API_KEY = "chama_api_23c3e7ffb034f25cf474f6d7ac266f9b"; // ඔබේ API Key එක දාන්න
    const DEFAULT_IMAGE = "https://chama-movie-api.koyeb.app/logo.png";

    try {
        const searchResponse = await axios.get(`${API_BASE}/api/v1/movie/baiscope/search?q=${encodeURIComponent(query)}&api_key=${API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.data || searchData.data.length === 0) {
            await socket.sendMessage(sender, {
                text: `*❪ NO RESULTS ❫*\n\n😞 *No Results Found!*\n\n🎬 *Query:* _${query}_\n💡 *Tip:* _Please check the spelling and try again!_${DEFAULT_FOOTER}`
            }, { quoted: msg });
            break;
        }

        const results = searchData.data.slice(0, 25);
        let listText = `*❪ SEARCH RESULTS ❫*\n\n🎯 *Query:* _${query}_\n📊 *Results:* _${results.length} Items_\n\n*👇 SELECT A NUMBER 👇*\n\n`;

        results.forEach((item, index) => {
            const typeIcon = item.type === 'tvshows' ? '📺' : '🎥';
            const num = (index + 1) < 10 ? `0${index + 1}` : `${index + 1}`;
            listText += `*${num}* ➜ ${typeIcon} _${item.title.substring(0, 30)}_\n`;
        });

        listText += `${DEFAULT_FOOTER}`;
        
        const sentMsg = await socket.sendMessage(sender, { text: listText }, { quoted: msg });
        const messageID = sentMsg.key.id;

        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= results.length) {
                    await socket.sendMessage(sender, {
                        text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - ${results.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = results[choice];
                const isTvShow = selectedItem.type === 'tvshows';
                
                if (isTvShow) {
                    await socket.sendMessage(sender, { 
                        text: `*❪ FETCHING ❫*\n\n📺 *Fetching TV Series...*\n⚡ _Please wait..._`
                    }, { quoted: replyMek });

                    try {
                        const tvShowResponse = await axios.get(`${API_BASE}/api/v1/movie/baiscope/tv/info?q=${encodeURIComponent(selectedItem.link)}&api_key=${API_KEY}`);
                        const tvShowData = tvShowResponse.data;

                        if (!tvShowData.status || !tvShowData.data) {
                            throw new Error('Failed to fetch TV show details');
                        }

                        const tvInfo = tvShowData.data;
                        
                        let tvDetailsText = `*❪ TV SERIES DETAILS ❫*\n\n📺 *${tvInfo.title}*\n⭐ 𝗜ᴍᴅʙ ➜ ★ ${tvInfo.rating || 'N/A'}\n📅 𝗬ᴇᴀʀ ➜ ${tvInfo.year || 'N/A'}\n⏳ ➜ ${tvInfo.duration || 'N/A'}\n🌍 ➜ ${tvInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻 genres ➜ ${tvInfo.genres ? tvInfo.genres.join(', ') : 'N/A'}\n🎬 ➜ ${tvInfo.director || 'N/A'}\n⭐ 𝗦ᴛᴀʀ𝘀: ${tvInfo.stars || 'N/A'}\n📝 𝗦𝘁𝗼𝗿𝘆 ➜ ${tvInfo.story ? (tvInfo.story.length > 250 ? tvInfo.story.substring(0, 250) + '...' : tvInfo.story) : 'N/A'}\n🗿 ➜ baiscope.lk\n${DEFAULT_FOOTER}`;

                        const posterUrl = tvInfo.image || selectedItem.image || DEFAULT_IMAGE;
                        await socket.sendMessage(sender, {
                            image: { url: posterUrl },
                            caption: tvDetailsText
                        }, { quoted: replyMek });

                        // AUTO DOWNLOAD ALL EPISODES
                        await socket.sendMessage(sender, { 
                            text: `*❪ DOWNLOAD EPISODES ❫*\n\n📺 *Series:* _${tvInfo.title}_\n🎬 *Episodes:* _${tvInfo.episodes.length}_\n⚡ _Starting download process..._${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });

                        let successCount = 0;
                        let failCount = 0;

                        for (let i = 0; i < tvInfo.episodes.length; i++) {
                            const episode = tvInfo.episodes[i];
                            try {
                                await socket.sendMessage(sender, { 
                                    text: `*❪ DOWNLOADING ❫*\n\n🎥 *Episode:* _${episode.episode_name}_\n📊 *Progress:* _${i + 1}/${tvInfo.episodes.length}_`
                                }, { quoted: replyMek });

                                const epDlRes = await axios.get(`${API_BASE}/api/v1/movie/baiscope/tv/dl?q=${encodeURIComponent(episode.episode_url)}&api_key=${API_KEY}`);
                                const epDlData = epDlRes.data;

                                if (epDlData.status && epDlData.data && epDlData.data.length > 0) {
                                    const nonTelegramLinks = epDlData.data.filter(link => 
                                        link.link && !link.link.includes('t.me') && !link.link.includes('telegram')
                                    );
                                    const finalLinkObj = nonTelegramLinks[0] || epDlData.data[0];
                                    
                                    await socket.sendMessage(sender, {
                                        document: { url: finalLinkObj.link },
                                        mimetype: 'video/mp4',
                                        fileName: `${tvInfo.title} - ${episode.episode_name}.mp4`,
                                        caption: `*📺 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳 📺*\n\n🎭 *Title:* ${tvInfo.title}\n📌 *Episode:* ${episode.episode_name}\n📊 *Quality:* Direct MP4\n\n${DEFAULT_FOOTER}`
                                    }, { quoted: replyMek });
                                    
                                    successCount++;
                                } else {
                                    failCount++;
                                }
                                
                                await new Promise(resolve => setTimeout(resolve, 2500));
                                
                            } catch (epError) {
                                console.error(`Error downloading episode:`, epError);
                                failCount++;
                            }
                        }
                        
                        await socket.sendMessage(sender, { 
                            text: `*❪ SUMMARY ❫*\n\n🎉 *Download Complete!*\n\n🎬 *Series:* _${tvInfo.title}_\n✅ *Success:* _${successCount} Episodes_\n❌ *Failed:* _${failCount} Episodes_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });

                        socket.ev.off('messages.upsert', handleSelection);
                        
                    } catch (tvShowError) {
                        console.error('TV Show error:', tvShowError);
                        await socket.sendMessage(sender, {
                            text: `*❪ ERROR ❫*\n\n❌ *TV Details Error!*\n🚫 _${tvShowError.message}_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                    }
                    
                } else {
                    // MOVIE FLOW
                    await socket.sendMessage(sender, { 
                        text: `*❪ FETCHING ❫*\n\n🎬 *Fetching Movie...*\n⚡ _Please wait..._`
                    }, { quoted: replyMek });

                    try {
                        const detailsResponse = await axios.get(`${API_BASE}/api/v1/movie/baiscope/infodl?q=${encodeURIComponent(selectedItem.link)}&api_key=${API_KEY}`);
                        const detailsData = detailsResponse.data;

                        if (!detailsData.status || !detailsData.data) {
                            throw new Error('Failed to fetch details');
                        }

                        const movieInfo = detailsData.data;
                        const validDownloads = movieInfo.downloads || [];
                        
                        if (validDownloads.length === 0) {
                            await socket.sendMessage(sender, {
                                text: `*❪ NO DOWNLOADS ❫*\n\n⚠️ *No Downloads Found!*\n😞 _There are no downloads available for this movie!_${DEFAULT_FOOTER}`
                            }, { quoted: replyMek });
                            return;
                        }
                        
                        const movieDetailsText = `*❪ MOVIE DETAILS ❫*\n\n🎬 *${movieInfo.title}*\n⭐ 𝗜𝗠𝗗𝗕 ➜ ★ ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 𝗬𝗲𝗮𝗿 ➜ ${movieInfo.year || 'N/A'}\n⏳ 𝗗𝘂𝗿𝗮𝘁𝗶𝗼𝗻 ➜ ${movieInfo.duration || 'N/A'}\n🌍 ➜ ${movieInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻 genres ➜ ${movieInfo.genres ? movieInfo.genres.join(', ') : 'N/A'}\n🏷️ ➜ ${movieInfo.language || 'N/A'}\n🎬  ➜ ${movieInfo.director || 'N/A'}\n⭐  ➜ ${movieInfo.stars || 'N/A'}\n📝  ➜ ${movieInfo.story ? (movieInfo.story.length > 250 ? movieInfo.story.substring(0, 250) + '...' : movieInfo.story) : 'N/A'}\n🗿 🗿 ➜ baiscope.lk\n${DEFAULT_FOOTER}`;

                        const moviePosterUrl = movieInfo.image || selectedItem.image || DEFAULT_IMAGE;
                        await socket.sendMessage(sender, {
                            image: { url: moviePosterUrl },
                            caption: movieDetailsText
                        }, { quoted: replyMek });

                        const downloadOptionsText = `*❪ DOWNLOADS ❫*\n\n📥 *Select Quality:*\n\n${validDownloads.map((dl, i) => {
    const num = (i + 1) < 10 ? `0${i + 1}` : `${i + 1}`;
    const qualityIcon = (dl.quality || '').includes('1080') ? '🔥' : (dl.quality || '').includes('720') ? '💎' : '📱';
    return `*${num}* ➜ ${qualityIcon} _${dl.quality}_ 💾 _${dl.size || 'N/A'}_`;
}).join('\n')}\n\n*💬 REPLY TO DOWNLOAD 💬*\n📌 _Reply with the number_${DEFAULT_FOOTER}`;

                        const downloadOptionsMsg = await socket.sendMessage(sender, { text: downloadOptionsText }, { quoted: replyMek });
                        const optionsMsgID = downloadOptionsMsg.key.id;

                        const handleDownload = async ({ messages: downloadMessages }) => {
                            const downloadMek = downloadMessages[0];
                            if (!downloadMek?.message) return;

                            const downloadChoice = downloadMek.message.conversation || downloadMek.message.extendedTextMessage?.text;
                            const isReplyToOptionsMsg = downloadMek.message.extendedTextMessage?.contextInfo?.stanzaId === optionsMsgID;

                            if (isReplyToOptionsMsg && sender === downloadMek.key.remoteJid) {
                                const choiceNum = parseInt(downloadChoice) - 1;
                                
                                if (isNaN(choiceNum) || choiceNum < 0 || choiceNum >= validDownloads.length) {
                                    await socket.sendMessage(sender, {
                                        text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - ${validDownloads.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                                    }, { quoted: downloadMek });
                                    return;
                                }

                                const selectedDownload = validDownloads[choiceNum];
                                await socket.sendMessage(sender, { react: { text: '📥', key: downloadMek.key } });

                                try {
                                    const finalDirectLink = selectedDownload.link;

                                    await socket.sendMessage(sender, {
                                        document: { url: finalDirectLink },
                                        mimetype: 'video/mp4',
                                        fileName: `${movieInfo.title} - ${selectedDownload.quality}.mp4`,
                                        caption: `*🎬 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳🎬*\n\n🎭 *Title:* ${movieInfo.title}\n🌟 *IMDB:* ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 *Year:* ${movieInfo.year || 'N/A'}\n📊 *Quality:* ${selectedDownload.quality}\n💾 *Size:* ${selectedDownload.size || 'N/A'}\n\n${DEFAULT_FOOTER}`
                                    }, { quoted: downloadMek });

                                    await socket.sendMessage(sender, { react: { text: '✅', key: downloadMek.key } });

                                } catch (downloadError) {
                                    console.error('Download link error:', downloadError);
                                    await socket.sendMessage(sender, {
                                        text: `*❪ ERROR ❫*\n\n❌ *Download Failed!*\n🚫 _${downloadError.message}_${DEFAULT_FOOTER}`
                                    }, { quoted: downloadMek });
                                } finally {
                                    socket.ev.off('messages.upsert', handleDownload);
                                    socket.ev.off('messages.upsert', handleSelection);
                                }
                            }
                        };

                        socket.ev.on('messages.upsert', handleDownload);

                    } catch (detailsError) {
                        console.error('Details error:', detailsError);
                        await socket.sendMessage(sender, {
                            text: `*❪ ERROR ❫*\n\n❌ *Movie Details Error!*\n🚫 _${detailsError.message}_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                    }
                }
            }
        };

        socket.ev.on('messages.upsert', handleSelection);

    } catch (error) {
        console.error('Baiscope command error:', error);
        await socket.sendMessage(sender, {
            text: `*❪ SYSTEM ERROR ❫*\n\n❌ *System Error!*\n🚫 _${error.message || 'Unknown error'}_\n\n🔄 _Please try again later..._${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }
}
              case 'sinhalacartoons':             
case 'cartoon': {
    const DEFAULT_FOOTER = `\n\n> 🧚‍♂️ DCT NINJA X MD 🧚‍♂️\n> 🧬 ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text: `*❪ ERROR ❫*\n\n⚠️ *Invalid Usage!*\n\n🎬 *Example:*
• .cartoon ben 10
• .sinhalacartoons frozen\n\n📝 _Please provide the Cartoon_ _or Anime name!_${DEFAULT_FOOTER}`
        }, { quoted: msg });
        break;
    }

    const query = args.join(' ');
    await socket.sendMessage(sender, { 
        text: `*❪ SEARCHING ❫*\n\n🔍 *Searching Sinhalacartoons...*\n⚡ _Please wait a moment._`
    });

    const API_BASE = "https://chama-movie-api.koyeb.app";
    const API_KEY = "chama_api_23c3e7ffb034f25cf474f6d7ac266f9b"; // ඔබේ API Key එක දාන්න
    const DEFAULT_IMAGE = "https://chama-movie-api.koyeb.app/logo.png";

    try {
        const searchResponse = await axios.get(`${API_BASE}/api/v1/movie/sinhalacartoons/search?q=${encodeURIComponent(query)}&api_key=${API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.data || searchData.data.length === 0) {
            await socket.sendMessage(sender, {
                text: `*❪ NO RESULTS ❫*\n\n😞 *No Results Found!*\n\n🎬 *Query:* _${query}_\n💡 *Tip:* _Please check the spelling and try again!_${DEFAULT_FOOTER}`
            }, { quoted: msg });
            break;
        }

        const results = searchData.data.slice(0, 25);
        let listText = `*❪ SEARCH RESULTS ❫*\n\n🎯 *Query:* _${query}_\n📊 *Results:* _${results.length} Items_\n\n*👇 SELECT A NUMBER 👇*\n\n`;

        results.forEach((item, index) => {
            const num = (index + 1) < 10 ? `0${index + 1}` : `${index + 1}`;
            listText += `*${num}* ➜ 📺 _${item.title.substring(0, 30)}_\n`;
        });

        listText += `${DEFAULT_FOOTER}`;
        
        const sentMsg = await socket.sendMessage(sender, { text: listText }, { quoted: msg });
        const messageID = sentMsg.key.id;

        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= results.length) {
                    await socket.sendMessage(sender, {
                        text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - ${results.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = results[choice];
                
                await socket.sendMessage(sender, { 
                    text: `*❪ FETCHING ❫*\n\n📺 *Fetching Cartoon Details...*\n⚡ _Please wait..._`
                }, { quoted: replyMek });

                try {
                    const detailsResponse = await axios.get(`${API_BASE}/api/v1/movie/sinhalacartoons/infodl?q=${encodeURIComponent(selectedItem.link)}&api_key=${API_KEY}`);
                    const detailsData = detailsResponse.data;

                    if (!detailsData.status || !detailsData.data) {
                        throw new Error('Failed to fetch details');
                    }

                    const cartoonInfo = detailsData.data;
                    const validDownloads = cartoonInfo.downloads || [];
                    
                    if (validDownloads.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `*❪ NO DOWNLOADS ❫*\n\n⚠️ *No Downloads Found!*\n😞 _There are no downloads available for this cartoon!_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        return;
                    }
                    
                    const detailsText = `*❪ CARTOON DETAILS ❫*\n\n🎬 *${cartoonInfo.title}*\n⭐ 𝗜𝗠𝗗𝗕 ➜ ★ ${cartoonInfo.imdb || cartoonInfo.rating || 'N/A'}\n📅 𝗬𝗲𝗮𝗿 ➜ ${cartoonInfo.year || 'N/A'}\n⏳ 𝗗𝘂𝗿𝗮𝘁𝗶𝗼𝗻 ➜ ${cartoonInfo.duration || 'N/A'}\n🌍 𝗖ᴏᴜɴ𝘁𝗿ʏ ➜ ${cartoonInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻 genres ➜ ${cartoonInfo.genres ? cartoonInfo.genres.join(', ') : 'N/A'}\n🏷️ ➜ ${cartoonInfo.language || 'N/A'}\n🎬  ➜ ${cartoonInfo.director || 'N/A'}\n📝 𝗦𝘁𝗼𝗿𝘆 ➜ ${cartoonInfo.story ? (cartoonInfo.story.length > 250 ? cartoonInfo.story.substring(0, 250) + '...' : cartoonInfo.story) : 'N/A'}\n🗿  ➜ sinhalacartoons.com\n${DEFAULT_FOOTER}`;

                    const posterUrl = cartoonInfo.image || selectedItem.image || DEFAULT_IMAGE;
                    await socket.sendMessage(sender, {
                        image: { url: posterUrl },
                        caption: detailsText
                    }, { quoted: replyMek });

                    const downloadOptionsText = `*❪ DOWNLOADS ❫*\n\n📥 *Select Episode / Quality:*\n\n${validDownloads.map((dl, i) => {
    const num = (i + 1) < 10 ? `0${i + 1}` : `${i + 1}`;
    return `*${num}* ➜ 💾 _${dl.quality}_ 📁 _${dl.size || 'N/A'}_`;
}).join('\n')}\n\n*💬 REPLY TO DOWNLOAD 💬*\n📌 _Reply with the number_${DEFAULT_FOOTER}`;

                    const downloadOptionsMsg = await socket.sendMessage(sender, { text: downloadOptionsText }, { quoted: replyMek });
                    const optionsMsgID = downloadOptionsMsg.key.id;

                    const handleDownload = async ({ messages: downloadMessages }) => {
                        const downloadMek = downloadMessages[0];
                        if (!downloadMek?.message) return;

                        const downloadChoice = downloadMek.message.conversation || downloadMek.message.extendedTextMessage?.text;
                        const isReplyToOptionsMsg = downloadMek.message.extendedTextMessage?.contextInfo?.stanzaId === optionsMsgID;

                        if (isReplyToOptionsMsg && sender === downloadMek.key.remoteJid) {
                            const choiceNum = parseInt(downloadChoice) - 1;
                            
                            if (isNaN(choiceNum) || choiceNum < 0 || choiceNum >= validDownloads.length) {
                                await socket.sendMessage(sender, {
                                    text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - ${validDownloads.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                                }, { quoted: downloadMek });
                                return;
                            }

                            const selectedDownload = validDownloads[choiceNum];
                            await socket.sendMessage(sender, { react: { text: '📥', key: downloadMek.key } });

                            try {
                                const finalDirectLink = selectedDownload.link;

                                await socket.sendMessage(sender, {
                                    document: { url: finalDirectLink },
                                    mimetype: 'video/mp4',
                                    fileName: `${cartoonInfo.title} - ${selectedDownload.quality}.mp4`,
                                    caption: `*❪ CARTOON ❫*\n\n🎭 *${cartoonInfo.title}*\n📌 *Episode:* _{selectedDownload.quality}_${DEFAULT_FOOTER}`
                                }, { quoted: downloadMek });

                                await socket.sendMessage(sender, { react: { text: '✅', key: downloadMek.key } });

                            } catch (downloadError) {
                                console.error('Download link error:', downloadError);
                                await socket.sendMessage(sender, {
                                    text: `*❪ ERROR ❫*\n\n❌ *Download Failed!*\n🚫 _${downloadError.message}_${DEFAULT_FOOTER}`
                                }, { quoted: downloadMek });
                            } finally {
                                socket.ev.off('messages.upsert', handleDownload);
                                socket.ev.off('messages.upsert', handleSelection);
                            }
                        }
                    };

                    socket.ev.on('messages.upsert', handleDownload);

                } catch (detailsError) {
                    console.error('Details error:', detailsError);
                    await socket.sendMessage(sender, {
                        text: `*❪ ERROR ❫*\n\n❌ *Cartoon Details Error!*\n🚫 _${detailsError.message}_${DEFAULT_FOOTER}`
                    }, { quoted: replyMek });
                    socket.ev.off('messages.upsert', handleSelection);
                }
            }
        };

        socket.ev.on('messages.upsert', handleSelection);

    } catch (error) {
        console.error('Sinhalacartoons command error:', error);
        await socket.sendMessage(sender, {
            text: `*❪ SYSTEM ERROR ❫*\n\n❌ *System Error!*\n🚫 _${error.message || 'Unknown error'}_\n\n🔄 _Please try again later..._${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }
    
    break;
    }
              case 'cinesubz':             
case 'cinetv': {
    const DEFAULT_FOOTER = `\n\n> 🎭 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳 🎭\n> 🧬 ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝙽𝙸𝙽𝙹𝙰-𝚇-𝙼𝙳`;

    if (!args.length) {
        await socket.sendMessage(sender, {
            text: `*❪ ERROR ❫*\n\n⚠️ *Invalid Usage!*\n\n🎬 *Example:*
• .cinetv spider man
• .cinesubz game of thrones\n\n📝 _Please provide the Movie_ _or TV Series name!_${DEFAULT_FOOTER}`
        }, { quoted: msg });
        break;
    }

    const cinesubQuery = args.join(' ');
    await socket.sendMessage(sender, { 
        text: `*❪ SEARCHING ❫*\n\n🔍 *Searching Cinesubz...*\n⚡ _Please wait a moment._`
    });

    const API_BASE = "https://chama-movie-api.koyeb.app";
    const API_KEY = "chama_api_23c3e7ffb034f25cf474f6d7ac266f9b"; // ඔබේ API Key එක දාන්න
    const DEFAULT_IMAGE = "https://chama-movie-api.koyeb.app/logo.png";

    try {
        const searchResponse = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/search?q=${encodeURIComponent(cinesubQuery)}&api_key=${API_KEY}`);
        const searchData = searchResponse.data;

        if (!searchData.status || !searchData.data || searchData.data.length === 0) {
            await socket.sendMessage(sender, {
                text: `*❪ NO RESULTS ❫*\n\n😞 *No Results Found!*\n\n🎬 *Query:* _${cinesubQuery}_\n💡 *Tip:* _Please check the spelling and try again!_${DEFAULT_FOOTER}`
            }, { quoted: msg });
            break;
        }

        const cinesubResults = searchData.data.slice(0, 25);
        let listText = `*❪ SEARCH RESULTS ❫*\n\n🎯 *Query:* _${cinesubQuery}_\n📊 *Results:* _${cinesubResults.length} Items_\n\n*👇 SELECT A NUMBER 👇*\n\n`;

        cinesubResults.forEach((item, index) => {
            const typeIcon = item.type === 'tvshows' ? '📺' : '🎥';
            const num = (index + 1) < 10 ? `0${index + 1}` : `${index + 1}`;
            listText += `*${num}* ➜ ${typeIcon} _${item.title.substring(0, 30)}_\n`;
        });

        listText += `${DEFAULT_FOOTER}`;
        
        const sentMsg = await socket.sendMessage(sender, { text: listText }, { quoted: msg });
        const messageID = sentMsg.key.id;

        const handleSelection = async ({ messages: replyMessages }) => {
            const replyMek = replyMessages[0];
            if (!replyMek?.message) return;

            const messageType = replyMek.message.conversation || replyMek.message.extendedTextMessage?.text;
            const isReplyToSentMsg = replyMek.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

            if (isReplyToSentMsg && sender === replyMek.key.remoteJid) {
                const choice = parseInt(messageType) - 1;
                if (isNaN(choice) || choice < 0 || choice >= cinesubResults.length) {
                    await socket.sendMessage(sender, {
                        text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - ${cinesubResults.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                    }, { quoted: replyMek });
                    return;
                }

                const selectedItem = cinesubResults[choice];
                const isTvShow = selectedItem.type === 'tvshows';
                
                if (isTvShow) {
                    await socket.sendMessage(sender, { 
                        text: `*❪ FETCHING ❫*\n\n📺 *Fetching TV Series...*\n⚡ _Please wait..._`
                    }, { quoted: replyMek });

                    try {
                        const tvShowResponse = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/tv/info?q=${encodeURIComponent(selectedItem.link)}&api_key=${API_KEY}`);
                        const tvShowData = tvShowResponse.data;

                        if (!tvShowData.status || !tvShowData.data) {
                            throw new Error('Failed to fetch TV show details');
                        }

                        const tvInfo = tvShowData.data;
                        
                        let tvDetailsText = `*❪ TV SERIES DETAILS ❫*\n\n📺 *${tvInfo.title}*\n⭐ 𝗜ᴍᴅʙ ➜ ★ ${tvInfo.rating || 'N/A'}\n📅 𝗬ᴇᴀʀ ➜ ${tvInfo.year || 'N/A'}\n⏳ 𝗥ᴜɴᴛɪᴍᴇ ➜ ${tvInfo.duration || 'N/A'}\n🌍 𝗖ᴏᴜɴ𝘁𝗿ʏ ➜ ${tvInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻 genres ➜ ${tvInfo.genres ? tvInfo.genres.join(', ') : 'N/A'}\n🎬 𝗗ɪʀᴇᴄᴛᴏʀ ➜ ${tvInfo.directors || 'N/A'}\n⭐ 𝗦ᴛᴀʀ𝘀: ${tvInfo.stars || 'N/A'}\n📝 𝗦𝘁𝗼𝗿𝘆 ➜ ${tvInfo.story ? (tvInfo.story.length > 250 ? tvInfo.story.substring(0, 250) + '...' : tvInfo.story) : 'N/A'}\n🗿 𝗪ᴇʙ ➜ cinesubz.com\n ${DEFAULT_FOOTER}`;

                        const posterUrl = tvInfo.image || selectedItem.image || DEFAULT_IMAGE;
                        await socket.sendMessage(sender, {
                            image: { url: posterUrl },
                            caption: tvDetailsText
                        }, { quoted: replyMek });

                        // AUTO DOWNLOAD ALL EPISODES
                        await socket.sendMessage(sender, { 
                            text: `*❪ DOWNLOAD EPISODES ❫*\n\n📺 *Series:* _${tvInfo.title}_\n🎬 *Episodes:* _${tvInfo.episodes.length}_\n⚡ _Starting download process..._${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });

                        let successCount = 0;
                        let failCount = 0;

                        for (let i = 0; i < tvInfo.episodes.length; i++) {
                            const episode = tvInfo.episodes[i];
                            try {
                                await socket.sendMessage(sender, { 
                                    text: `*❪ DOWNLOADING ❫*\n\n🎥 *Episode:* _${episode.episode_name}_\n📊 *Progress:* _${i + 1}/${tvInfo.episodes.length}_`
                                }, { quoted: replyMek });

                                const epDlRes = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/tv/dl?q=${encodeURIComponent(episode.episode_url)}&api_key=${API_KEY}`);
                                const epDlData = epDlRes.data;

                                if (epDlData.status && epDlData.data && epDlData.data.length > 0) {
                                    const nonTelegramLinks = epDlData.data.filter(link => 
                                        link.link && !link.link.includes('t.me') && !link.link.includes('telegram')
                                    );
                                    const finalLinkObj = nonTelegramLinks[0] || epDlData.data[0];
                                    
                                    await socket.sendMessage(sender, {
                                        document: { url: finalLinkObj.link },
                                        mimetype: 'video/mp4',
                                        fileName: `${tvInfo.title} - ${episode.episode_name}.mp4`,
                                        caption: `*📺 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳 📺*\n\n🎭 *Title:* ${tvInfo.title}\n📌 *Episode:* ${episode.episode_name}\n📊 *Quality:* Direct MP4\n\n${DEFAULT_FOOTER}`
                                    }, { quoted: replyMek });
                                    
                                    successCount++;
                                } else {
                                    failCount++;
                                }
                                
                                await new Promise(resolve => setTimeout(resolve, 2500));
                                
                            } catch (epError) {
                                console.error(`Error downloading episode:`, epError);
                                failCount++;
                            }
                        }
                        
                        await socket.sendMessage(sender, { 
                            text: `*❪ SUMMARY ❫*\n\n🎉 *Download Complete!*\n\n🎬 *Series:* _${tvInfo.title}_\n✅ *Success:* _${successCount} Episodes_\n❌ *Failed:* _${failCount} Episodes_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });

                        socket.ev.off('messages.upsert', handleSelection);
                        
                    } catch (tvShowError) {
                        console.error('TV Show error:', tvShowError);
                        await socket.sendMessage(sender, {
                            text: `*❪ ERROR ❫*\n\n❌ *TV Details Error!*\n🚫 _${tvShowError.message}_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                    }
                    
                } else {
                    // MOVIE FLOW
                    await socket.sendMessage(sender, { 
                        text: `*❪ FETCHING ❫*\n\n🎬 *Fetching Movie...*\n⚡ _Please wait..._`
                    }, { quoted: replyMek });

                    try {
                        const detailsResponse = await axios.get(`${API_BASE}/api/v1/movie/cinesubz/infodl?q=${encodeURIComponent(selectedItem.link)}&api_key=${API_KEY}`);
                        const detailsData = detailsResponse.data;

                        if (!detailsData.status || !detailsData.data) {
                            throw new Error('Failed to fetch details');
                        }

                        const movieInfo = detailsData.data;
                        const validDownloads = movieInfo.downloads || [];
                        
                        if (validDownloads.length === 0) {
                            await socket.sendMessage(sender, {
                                text: `*❪ NO DOWNLOADS ❫*\n\n⚠️ *No Downloads Found!*\n😞 _There are no downloads available for this movie!_${DEFAULT_FOOTER}`
                            }, { quoted: replyMek });
                            return;
                        }
                        
                        const movieDetailsText = `*❪ MOVIE DETAILS ❫*\n\n🎬 *${movieInfo.title}*\n⭐ 𝗜𝗠𝗗𝗕 ➜ ★ ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 𝗬𝗲𝗮𝗿 ➜ ${movieInfo.year || 'N/A'}\n⏳ 𝗗𝘂𝗿𝗮𝘁𝗶𝗼𝗻 ➜ ${movieInfo.duration || 'N/A'}\n🌍 𝗖ᴏᴜɴ𝘁𝗿ʏ ➜ ${movieInfo.country || 'N/A'}\n🎭 𝗚𝗲𝗻 genres ➜ ${movieInfo.genres ? movieInfo.genres.join(', ') : 'N/A'}\n🏷️  ➜ ${movieInfo.language || movieInfo.tag || 'N/A'}\n🎬  ➜ ${movieInfo.directors || movieInfo.director || 'N/A'}\n⭐  ➜ ${movieInfo.stars || 'N/A'}\n📝  ➜ ${movieInfo.story ? (movieInfo.story.length > 250 ? movieInfo.story.substring(0, 250) + '...' : movieInfo.story) : 'N/A'}\n🗿 𝗪ᴇʙ ➜ cinesubz.com\n ${DEFAULT_FOOTER}`;

                        const moviePosterUrl = movieInfo.image || selectedItem.image || DEFAULT_IMAGE;
                        await socket.sendMessage(sender, {
                            image: { url: moviePosterUrl },
                            caption: movieDetailsText
                        }, { quoted: replyMek });

                        const downloadOptionsText = `*❪ DOWNLOADS ❫*\n\n📥 *Select Quality:*\n\n${validDownloads.map((dl, i) => {
    const num = (i + 1) < 10 ? `0${i + 1}` : `${i + 1}`;
    const qualityIcon = (dl.quality || '').includes('1080') ? '🔥' : (dl.quality || '').includes('720') ? '💎' : '📱';
    return `*${num}* ➜ ${qualityIcon} _${dl.quality}_ 💾 _${dl.size || 'N/A'}_`;
}).join('\n')}\n\n*💬 REPLY TO DOWNLOAD 💬*\n📌 _Reply with the number_${DEFAULT_FOOTER}`;

                        const downloadOptionsMsg = await socket.sendMessage(sender, { text: downloadOptionsText }, { quoted: replyMek });
                        const optionsMsgID = downloadOptionsMsg.key.id;

                        const handleDownload = async ({ messages: downloadMessages }) => {
                            const downloadMek = downloadMessages[0];
                            if (!downloadMek?.message) return;

                            const downloadChoice = downloadMek.message.conversation || downloadMek.message.extendedTextMessage?.text;
                            const isReplyToOptionsMsg = downloadMek.message.extendedTextMessage?.contextInfo?.stanzaId === optionsMsgID;

                            if (isReplyToOptionsMsg && sender === downloadMek.key.remoteJid) {
                                const choiceNum = parseInt(downloadChoice) - 1;
                                
                                if (isNaN(choiceNum) || choiceNum < 0 || choiceNum >= validDownloads.length) {
                                    await socket.sendMessage(sender, {
                                        text: `*❪ INVALID ❫*\n\n⚠️ *Wrong Number!*\n🎯 *Range:* _01 - ${validDownloads.length}_\n📝 _Please reply with a valid number!_${DEFAULT_FOOTER}`
                                    }, { quoted: downloadMek });
                                    return;
                                }

                                const selectedDownload = validDownloads[choiceNum];
                                await socket.sendMessage(sender, { react: { text: '📥', key: downloadMek.key } });

                                try {
                                    const finalDirectLink = selectedDownload.link;

                                    await socket.sendMessage(sender, {
                                        document: { url: finalDirectLink },
                                        mimetype: 'video/mp4',
                                        fileName: `${movieInfo.title} - ${selectedDownload.quality}.mp4`,
                                        caption: `*🎬 𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳🎬*\n\n🎭 *Title:* ${movieInfo.title}\n🌟 *IMDB:* ${movieInfo.imdb || movieInfo.rating || 'N/A'}\n📅 *Year:* ${movieInfo.year || 'N/A'}\n📊 *Quality:* ${selectedDownload.quality}\n💾 *Size:* ${selectedDownload.size || 'N/A'}\n\n${DEFAULT_FOOTER}`
                                    }, { quoted: downloadMek });

                                    await socket.sendMessage(sender, { react: { text: '✅', key: downloadMek.key } });

                                } catch (downloadError) {
                                    console.error('Download link error:', downloadError);
                                    await socket.sendMessage(sender, {
                                        text: `*❪ ERROR ❫*\n\n❌ *Download Failed!*\n🚫 _${downloadError.message}_${DEFAULT_FOOTER}`
                                    }, { quoted: downloadMek });
                                } finally {
                                    socket.ev.off('messages.upsert', handleDownload);
                                    socket.ev.off('messages.upsert', handleSelection);
                                }
                            }
                        };

                        socket.ev.on('messages.upsert', handleDownload);

                    } catch (detailsError) {
                        console.error('Details error:', detailsError);
                        await socket.sendMessage(sender, {
                            text: `*❪ ERROR ❫*\n\n❌ *Movie Details Error!*\n🚫 _${detailsError.message}_${DEFAULT_FOOTER}`
                        }, { quoted: replyMek });
                        socket.ev.off('messages.upsert', handleSelection);
                    }
                }
            }
        };

        socket.ev.on('messages.upsert', handleSelection);

    } catch (error) {
        console.error('Cinesubz command error:', error);
        await socket.sendMessage(sender, {
            text: `*❪ SYSTEM ERROR ❫*\n\n❌ *System Error!*\n🚫 _${error.message || 'Unknown error'}_\n\n🔄 _Please try again later..._${DEFAULT_FOOTER}`
        }, { quoted: msg });
    }
    
    break;
                                             }
              case 'pair': {
          const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

          const q = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || '';

          const number = q.replace(/^[.\/!]?pair\s*/i, '').trim();
          const sanitizedNumber = number.replace(/[^0-9]/g, '');

          if (!number) {
            return await socket.sendMessage(sender, {
              text: '*🍁 Usage:* .pair +9470604XXXX'
            }, { quoted: msg });
          }

          try {
            const url = `https://ninja-x-md-production.up.railway.app/code?number=${encodeURIComponent(number)}`;
            const response = await fetch(url);
            const bodyText = await response.text();

            console.log("🌐 API Response:", bodyText);

            let result;
            try {
              result = JSON.parse(bodyText);
            } catch (e) {
              console.error("❌ JSON Parse Error:", e);
              return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
              }, { quoted: msg });
            }

            if (!result || !result.code) {
              return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
              }, { quoted: msg });
            }
            await socket.sendMessage(sender, { react: { text: '🔑', key: msg.key } });
            await socket.sendMessage(sender, {
              text: `*𝙿𝙰𝙸𝚁 𝙲𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳 ✓*

*🔑 Your pairing code is:* ${result.code}

*☘️ Creat Bot Steps ☘️*

*◈ 𝐎n 𝐘our 𝐏hone*
*◈ 𝐆o 𝐓o 𝐖hatsapp*
*◈ 𝐂lik 3 𝐃ots ❴⋮❵ 𝐎r 𝐆o 𝐓o 𝐒ettings*
*◈ 𝐓ap 𝐋ink 𝐃evice*
*◈ 𝐓ap 𝐋ink 𝐖ith 𝐂ord*
*◈ 𝐏ast 𝐘our 𝐂ord*

*⚠️ Important  Instructions*

*⦁ Pair This Cord Within 1 Minute*
*⦁ Do Not Shere This Cord Anyone*

* _© 𝙽𝙸𝙽𝙹𝙰-𝚇-𝙼𝙳_*`
            }, { quoted: msg });

            await sleep(2000);

            await socket.sendMessage(sender, {
              text: `${result.code}\n> > * _© 𝙽𝙸𝙽𝙹𝙰-𝚇-𝙼𝙳_*`
            }, { quoted: msg });

          } catch (err) {
            console.error("❌ Pair Command Error:", err);
            await socket.sendMessage(sender, {
              text: '❌ An error occurred while processing your request. Please try again later.'
            }, { quoted: msg });
          }

          break;
          }
        case 'menu': {
  try {
    await socket.sendMessage(sender, { react: { text: "🍷", key: msg.key } });

    const BOT_NAME = userConfig.botName || BOT_NAME_FANCY;
    const OWNER_NAME = config.OWNER_NAME || 'DCT DULA';
    const MENU_IMG = userConfig.logo || config.RCD_IMAGE_PATH;
    const pushName = msg.pushName || sender.split("@")[0];

    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const ramUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(require("os").totalmem() / 1024 / 1024);

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
    const date = now.toLocaleDateString("en-US");
    const time = now.toLocaleTimeString("en-US");

    const menuText = `
╭━━━〔 🔴 ᴅᴄᴛ ɴɪɴᴊᴀ x ᴍᴅ ™ 2.00 〕━━━⬣
┃ 👤 ᴜsᴇʀ : ${pushName}
┃ 📅 ᴅᴀᴛᴇ : ${date}
┃ ⏰ ᴛɪᴍᴇ : ${time}
┃ 🧠 sᴛᴀᴛᴜs : ⚡ ᴀᴄᴛɪᴠᴇ
┃ 💾 ʀᴀᴍ  : ${ramUsage} ᴍʙ
┃ 💻 ᴍᴇᴍ  : ${usedMemory}/${totalMemory} ᴍʙ
┃ ⏳ ᴜᴘᴛɪᴍᴇ : ${uptime}s
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔ᴄ ᴀ ᴛ ᴇ ɢ ᴏ ʀ ɪ ᴇ s 〕━━━⬣
│ 1 🔴 ❯❯ ᴍᴇᴅɪᴀ ᴍᴏᴅᴜʟᴇ
│ 2 🔴 ❯❯ ᴍᴏᴠɪᴇ ᴅᴇᴘᴏᴛ
│ 3 🔴 ❯❯ ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs
│ 4 🔴 ❯❯ sʏsᴛᴇᴍ sᴇᴛᴛɪɴɢs
│ 5 🔴 ❯❯ ɢʀᴏᴜᴘ ᴄᴏɴᴛʀᴏʟ
│ 6 🔴 ❯❯ ɴᴇᴡs ʙʀᴇᴀᴄʜ
│ 7 🔴 ❯❯ ᴅᴏᴡɴʟᴏᴀᴅ ᴇɴɢɪɴᴇ
│ 8 🔴 ❯❯ ᴀᴅᴍɪɴ ᴄᴏɴsᴏʟᴇ
╰────────────⬣

╭━━━〔 💡 ɴɪɴᴊᴀ ɴᴏᴛᴇ 〕━━━⬣
┃ ➤ ʀᴇᴘʟʏ ɴᴜᴍʙᴇʀ (1–8)
┃ ➤ ᴏʀ ᴜsᴇ ʙᴜᴛᴛᴏɴ ᴍᴏᴅᴇ ⚡
┃ ➤ sᴛᴀʏ sᴛᴇᴀʟᴛʜ • sᴛᴀʏ ʟᴇᴛʜᴀʟ ☠
╰━━━━━━━━━━━━━━━━━━━━⬣
`;

    let imagePayload = String(MENU_IMG).startsWith('http')
      ? { url: MENU_IMG }
      : fs.readFileSync(MENU_IMG);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: menuText,
      footer: "𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳",

      buttons: [
        { buttonId: '1', buttonText: { displayText: 'ᴍᴇᴅɪᴀ ᴍᴏᴅᴜʟᴇ' }, type: 1 },
        { buttonId: '2', buttonText: { displayText: 'ᴍᴏᴠɪᴇ ᴅᴇᴘᴏᴛ' }, type: 1 },
        { buttonId: '3', buttonText: { displayText: 'ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs' }, type: 1 },
        { buttonId: '4', buttonText: { displayText: 'sʏsᴛᴇᴍ sᴇᴛᴛɪɴɢs' }, type: 1 },
        { buttonId: '5', buttonText: { displayText: 'ɢʀᴏᴜᴘ ᴄᴏɴᴛʀᴏʟ' }, type: 1 },
        { buttonId: '6', buttonText: { displayText: 'ɴᴇᴡs ʙʀᴇᴀᴄʜ' }, type: 1 },
        { buttonId: '7', buttonText: { displayText: 'ᴅᴏᴡɴʟᴏᴀᴅ ᴇɴɢɪɴᴇ' }, type: 1 },
        { buttonId: '8', buttonText: { displayText: 'ᴀᴅᴍɪɴ ᴄᴏɴsᴏʟᴇ' }, type: 1 }
        
      ],

      headerType: 4,
      mentions: [sender]
    });

  } catch (e) {
    console.log(e);
    await socket.sendMessage(sender, { text: "❌ Menu Error" });
  }
  break;
}

/* =========================
   📂 1 - MEDIA MENU
========================= */
case '1': {
  await socket.sendMessage(sender, {
    text: `
╭━━━〔 🎵 MEDIA MENU 〕━━━⬣
┃ .song <name>
┃ .video <name>
┃ .ts <url>
┃ .tt / .tiktokdl <url>
┃ .fb / .fbdl / .facebook / .fbd <url>
┃ .mediafire / .mf / .mfdl <url>
┃ .apk / .apkdownload <name>
╰━━━━━━━━━━━━━━⬣
`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 },
      { buttonId: '2', buttonText: { displayText: '🎬 MOVIE' }, type: 1 },
      { buttonId: '3', buttonText: { displayText: '🌐 GENERAL' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   🎬 2 - MOVIE MENU
========================= */
case '2': {
  await socket.sendMessage(sender, {
    text: `
╭━━━〔 🎬 MOVIE MENU 〕━━━⬣
┃ .cinesubz <movie>
┃ .baiscopes <movie>
╰━━━━━━━━━━━━━━⬣
`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 },
      { buttonId: '1', buttonText: { displayText: '🎵 MEDIA' }, type: 1 },
      { buttonId: '3', buttonText: { displayText: '🌐 GENERAL' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   🌐 3 - GENERAL MENU
========================= */
case '3': {
  await socket.sendMessage(sender, {
    text: `
╭━━━〔 🌐 GENERAL MENU 〕━━━⬣
┃ .alive
┃ .menu
┃ .ping
┃ .owner
┃ .weather <city>
┃ .jid
┃ .getdp
┃ .font <text>
┃ .img <query>
╰━━━━━━━━━━━━━━⬣
`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 },
      { buttonId: '1', buttonText: { displayText: '🎵 MEDIA' }, type: 1 },
      { buttonId: '2', buttonText: { displayText: '🎬 MOVIE' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   ⚙️ 4 SETTINGS
========================= */
case '4': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 ⚙️ SETTINGS 〕━━━⬣
┃ .autotyping
┃ .autovoice
┃ .autorecording
┃ .rstatus
┃ .arm (auto reply mode)
┃ .creject (call reject)
┃ .mread (message read)
┃ .prefix <char>
┃ .emojis
┃ .setlogo <image>
┃ .setbotname <name>
┃ .settings
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   👥 5 GROUP
========================= */
case '5': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 👥 GROUP MENU 〕━━━⬣
┃ .tagall
┃ .online
┃ .kick
┃ .gjid / .groupjid / .grouplist
┃ .cid (channel id)
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   📰 6 NEWS
========================= */
case '6': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 📰 NEWS MENU 〕━━━⬣
┃ .news / .ada
┃ .hiru
┃ .sirasa
┃ .itn
┃ .lnw
┃ .bbc
┃ .siyatha
┃ .dasathalanka
┃ .lankadeepa
┃ .gagana
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   📥 7 OTHER
========================= */
case '7': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 📥 OTHER MENU 〕━━━⬣
┃ .tourl / .url / .upload
┃ .vv / .save / .දාපන් / .oni
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   🔧 8 ADMIN
========================= */
case '8': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 🔧 ADMIN MENU 〕━━━⬣
┃ .block
┃ .unblock
┃ .bots / .activesessions
┃ .sessions
┃ .deleteme
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

case 'දාපන්': case 'oni': case 'vv': case 'save': {
          try {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
            try { await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch (e) { }
            const saveChat = sender;
            if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
              const media = await downloadQuotedMedia(quotedMsg);
              if (!media || !media.buffer) return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
              if (quotedMsg.imageMessage) await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
              else if (quotedMsg.videoMessage) await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
              else if (quotedMsg.audioMessage) await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
              else if (quotedMsg.documentMessage) { const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`; await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' }); }
              else if (quotedMsg.stickerMessage) await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
              await socket.sendMessage(sender, { text: '🔥 *𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });
            } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
              const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
              await socket.sendMessage(saveChat, { text: `✅ *𝐒tatus 𝐒aved*\n\n${text}` });
              await socket.sendMessage(sender, { text: '🔥 *𝐓ext 𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });
            } else { await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg }); }
          } catch (error) { console.error('❌ Save error:', error); await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg }); }
          break;
        }


case 'alive': {
          try {
            const sanitized = (number || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            const botName = cfg.botName || BOT_NAME_FANCY;
            const logo = cfg.logo || config.RCD_IMAGE_PATH;
            const now = new Date();
            const sriLankaTime = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
            const sriLankaDate = new Date(sriLankaTime);
            const currentHour = sriLankaDate.getHours();
            let greeting = currentHour >= 5 && currentHour < 12 ? 'Good Morning 🌅' : (currentHour >= 12 && currentHour < 18 ? 'Good Afternoon' : 'Good Evening 🌙');
            const formattedDate = sriLankaDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'Asia/Colombo' });
            const formattedDay = sriLankaDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Colombo' });
            const formattedTime = sriLankaDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Colombo' });
            const startTime = socketCreationTime.get(number) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            const text = `*𝗛ɪ 👋 ${botName}*\n\n*╭───────────╮*\n*┃🗯️ 𝗚ʀᴇᴇᴛɪɴɢ :* ${greeting}\n*┃🗓️ 𝗗ᴀᴛᴇ  :* ${formattedDate}\n*┃📆 𝗗ᴀʏ  :* ${formattedDay}\n*┃⏱️ 𝗧ɪᴍᴇ :* ${formattedTime} (IST)\n*┃📄 𝗕ᴏᴛ 𝗡ᴀᴍᴇ :* ${botName}\n*┃🥷 𝗢ᴡɴᴇʀ :* ${config.OWNER_NAME || '@𝘿𝙘𝙩 𝘿𝙪𝙡𝙖 𝘿𝙚𝙫'}\n*┃🧬 𝗩ᴇʀꜱɪᴏɴ :* 2.0.0\n*┃🎈 𝗣ʟᴀᴛꜰᴏʀᴍ :* ${process.env.PLATFORM || '𝗛eroku'}\n*┃📟 𝗨ᴘᴛɪᴍᴇ :* ${hours}h ${minutes}m ${seconds}s\n*┃✒️ 𝗣ʀᴇꜰɪx :* .\n*╰────────────╯*`;
            let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);
            await socket.sendMessage(sender, { image: imagePayload, caption: text });
          } catch (e) { console.error('alive error', e); await socket.sendMessage(sender, { text: '❌ Failed to send alive status.' }, { quoted: msg }); }
          break;
        }

        // ==================== PING COMMAND ====================
        case 'ping': {
          try {
            const start = Date.now();
            const sanitized = (number || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            const botName = cfg.botName || BOT_NAME_FANCY;
            const logo = cfg.logo || config.RCD_IMAGE_PATH;
            const userTag = `@${sender.split("@")[0]}`;
            const now = new Date();
            const sriLankaTime = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
            const sriLankaDate = new Date(sriLankaTime);
            const currentHour = sriLankaDate.getHours();
            let greeting = currentHour >= 5 && currentHour < 12 ? 'Good Morning 🌅' : (currentHour >= 12 && currentHour < 18 ? 'Good Afternoon ☀️' : 'Good Evening 🌙');
            const formattedTime = sriLankaDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Colombo' });
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            const end = Date.now();
            const latency = end - start;
            const speedStatus = latency < 200 ? 'Excellent 🟢' : latency < 500 ? 'Good 🟡' : 'Slow 🔴';
            const text = `🏓 𝗣𝗢𝗡𝗚 𝗥𝗘𝗦𝗨𝗟𝗧\n\n👤 USER : ${userTag}\n🗯️ GREETING : ${greeting}\n⏰ TIME : ${formattedTime}\n\n⚡ SPEED : ${latency} ms\n🖥️ RUNTIME : ${hours}h ${minutes}m ${seconds}s\n📡 STATUS : ${speedStatus}\n\nThanks for using ${botName} 🚀`;
            let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);
            await socket.sendMessage(sender, { image: imagePayload, caption: text });
          } catch (e) { console.error('ping error', e); await socket.sendMessage(sender, { text: '❌ Failed to test ping.' }, { quoted: msg }); }
          break;
        }

        // ==================== OWNER COMMAND ====================
        case 'owner': {
          try { await socket.sendMessage(sender, { react: { text: "🥷", key: msg.key } }); } catch (e) {}
          const owners = [{ name: "☠︎︎ ᴅᴄᴛ ᴅᴜʟᴀ ᴅᴇᴠ </> ☠︎︎", number: "94752978237", email: "dula9x@gmail.com" }, { name: "❖ ─̲͞  ♥ ᴍᴀᴅᴜꜱᴀɴᴋᴀ🤍❖", number: "94756331255", email: "damithmadusanka179@gmail.com" }, { name: "❖ ─̲͞  ♥ ᴍᴀᴅᴜꜱᴀɴᴋᴀ🤍❖", number: "94787940686", email: "damithmadusanka9@gmail.com" }];
          const contactCards = owners.map(owner => ({ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${owner.name}\nORG:DCT Ninja X MD\nTEL;type=CELL;type=VOICE;waid=${owner.number}:${owner.number}\nEMAIL:${owner.email}\nEND:VCARD` }));
          await socket.sendMessage(sender, { contacts: { displayName: "DCT Ninja X MD Owners", contacts: contactCards } }, { quoted: msg });
          await socket.sendMessage(sender, { text: `╭━━〔 👑 *DCT NINJA X MD OWNER* 〕━━⬣\n┃ 📞 *☠︎︎ ᴅᴄᴛ ᴅᴜʟᴀ ᴅᴇᴠ </> ☠︎︎:* wa.me/94752978237\n┃ 📞 *❖ ─̲͞  ♥ ᴍᴀᴅᴜꜱᴀɴᴋᴀ🤍❖:* wa.me/94779357798\n┃ 📧 *Email:* dula9x@gmail.com\n┃ 📧 *Email:* damithmadusanka179@gmail.com\n╰━━━━━━━━━━━━━━⬣` });
          break;
        }

        // ==================== AUTO TYPING ====================
        case 'autotyping': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_TYPING = cfg.AUTO_TYPING === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_TYPING === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*AUTO TYPING* ${status}\n\n${cfg.AUTO_TYPING === 'true' ? '🟢 Bot will show typing indicator' : '🔴 Typing indicator disabled'}` }, { quoted: msg });
          } catch (e) { console.error('autotyping error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto typing.' }, { quoted: msg }); }
          break;
        }

        // ==================== AUTO VOICE ====================
        case 'autovoice': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_VOICE = cfg.AUTO_VOICE === 'on' ? 'off' : 'on';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_VOICE === 'on' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*AUTO VOICE* ${status}\n\n${cfg.AUTO_VOICE === 'on' ? '🔊 Auto voice messages activated' : '🔇 Auto voice disabled'}` }, { quoted: msg });
          } catch (e) { console.error('autovoice error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto voice.' }, { quoted: msg }); }
          break;
        }

        // ==================== AUTO RECORDING ====================
        case 'autorecording': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_RECORDING = cfg.AUTO_RECORDING === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_RECORDING === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*AUTO RECORDING* ${status}\n\n${cfg.AUTO_RECORDING === 'true' ? '🎙️ Recording indicator activated' : '⏹️ Recording indicator disabled'}` }, { quoted: msg });
          } catch (e) { console.error('autorecording error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto recording.' }, { quoted: msg }); }
          break;
        }

        // ==================== READ STATUS ====================
        case 'rstatus': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_VIEW_STATUS = cfg.AUTO_VIEW_STATUS === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_VIEW_STATUS === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*READ STATUS* ${status}\n\n${cfg.AUTO_VIEW_STATUS === 'true' ? '👁️ Status will be read automatically' : '🚫 Status read disabled'}` }, { quoted: msg });
          } catch (e) { console.error('rstatus error:', e); await socket.sendMessage(sender, { text: '❌ Error updating read status.' }, { quoted: msg }); }
          break;
        }

        // ==================== AUTO REPLY MODE ====================
        case 'arm': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_REPLY = cfg.AUTO_REPLY === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_REPLY === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*AUTO REPLY MODE* ${status}\n\n${cfg.AUTO_REPLY === 'true' ? '💬 Auto replies activated' : '🔇 Auto replies disabled'}` }, { quoted: msg });
          } catch (e) { console.error('arm error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto reply mode.' }, { quoted: msg }); }
          break;
        }

        // ==================== CALL REJECT ====================
        case 'creject': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.ANTI_CALL = cfg.ANTI_CALL === 'on' ? 'off' : 'on';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.ANTI_CALL === 'on' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*CALL REJECT* ${status}\n\n${cfg.ANTI_CALL === 'on' ? '📵 Incoming calls will be rejected' : '📱 Call rejection disabled'}` }, { quoted: msg });
          } catch (e) { console.error('creject error:', e); await socket.sendMessage(sender, { text: '❌ Error updating call reject.' }, { quoted: msg }); }
          break;
        }

        // ==================== MESSAGE READ ====================
        case 'mread': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.READ_COMMAND = cfg.READ_COMMAND === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.READ_COMMAND === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*MESSAGE READ* ${status}\n\n${cfg.READ_COMMAND === 'true' ? '✅ Messages will be read' : '❌ Message reading disabled'}` }, { quoted: msg });
          } catch (e) { console.error('mread error:', e); await socket.sendMessage(sender, { text: '❌ Error updating message read.' }, { quoted: msg }); }
          break;
        }

        // ==================== PREFIX ====================
        case 'prefix': {
          try {
            const newPrefix = args[0] || msg.message?.extendedTextMessage?.text?.split(' ')[1];
            if (!newPrefix) return await socket.sendMessage(sender, { text: '❌ *Please provide a prefix!*\n\nExample: .prefix !' }, { quoted: msg });
            if (newPrefix.length > 1) return await socket.sendMessage(sender, { text: '❌ *Prefix must be a single character!*' }, { quoted: msg });
            
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.PREFIX = newPrefix;
            await setUserConfigInMongo(sanitized, cfg);
            await socket.sendMessage(sender, { text: `✅ *PREFIX UPDATED*\n\nNew Prefix: *${newPrefix}*\n\nUse ${newPrefix} before commands.` }, { quoted: msg });
          } catch (e) { console.error('prefix error:', e); await socket.sendMessage(sender, { text: '❌ Error updating prefix.' }, { quoted: msg }); }
          break;
        }

        // ==================== EMOJIS ====================
        case 'emojis': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.EMOJIS = cfg.EMOJIS === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.EMOJIS === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*EMOJI MODE* ${status}\n\n${cfg.EMOJIS === 'true' ? '😂 Emoji responses activated' : '🔇 Emoji mode disabled'}` }, { quoted: msg });
          } catch (e) { console.error('emojis error:', e); await socket.sendMessage(sender, { text: '❌ Error updating emojis.' }, { quoted: msg }); }
          break;
        }

        // ==================== SET LOGO ====================
        case 'setlogo': {
          try {
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg?.imageMessage) return await socket.sendMessage(sender, { text: '❌ *Reply to an image to set as logo!*' }, { quoted: msg });
            
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            const imageUrl = await socket.downloadAndSaveMediaMessage(quotedMsg.imageMessage, 'image');
            cfg.logo = imageUrl;
            await setUserConfigInMongo(sanitized, cfg);
            
            await socket.sendMessage(sender, { text: '✅ *LOGO UPDATED!*\n\nNew logo has been set.' }, { quoted: msg });
          } catch (e) { console.error('setlogo error:', e); await socket.sendMessage(sender, { text: '❌ Error updating logo: ' + e.message }, { quoted: msg }); }
          break;
        }

        // ==================== SET BOT NAME ====================
        case 'setbotname': {
          try {
            const newName = args.join(' ') || msg.message?.extendedTextMessage?.text?.split('.setbotname')[1]?.trim();
            if (!newName || newName.length === 0) return await socket.sendMessage(sender, { text: '❌ *Please provide a bot name!*\n\nExample: .setbotname DCT NINJA BOT' }, { quoted: msg });
            if (newName.length > 50) return await socket.sendMessage(sender, { text: '❌ *Bot name is too long! (Max 50 characters)*' }, { quoted: msg });
            
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.botName = newName;
            await setUserConfigInMongo(sanitized, cfg);
            
            await socket.sendMessage(sender, { text: `✅ *BOT NAME UPDATED!*\n\n🤖 New Name: *${newName}*` }, { quoted: msg });
          } catch (e) { console.error('setbotname error:', e); await socket.sendMessage(sender, { text: '❌ Error updating bot name.' }, { quoted: msg }); }
          break;
        }

        // ==================== SETTINGS PANEL ====================
        case 'settings':
        case 'setting': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            
            const settingsPanel = `
*📋 CURRENT SETTINGS:*

🔹 *AUTO TYPING:*  ${cfg.AUTO_TYPING === 'true' ? '✅ ON' : '❌ OFF'}
   .autotyping

🔹 *AUTO VOICE:*  ${cfg.AUTO_VOICE === 'on' ? '✅ ON' : '❌ OFF'}
   .autovoice

🔹 *AUTO RECORDING:*  ${cfg.AUTO_RECORDING === 'true' ? '✅ ON' : '❌ OFF'}
   .autorecording

🔹 *READ STATUS:*  ${cfg.AUTO_VIEW_STATUS === 'true' ? '✅ ON' : '❌ OFF'}
   .rstatus

🔹 *AUTO REPLY:*  ${cfg.AUTO_REPLY === 'true' ? '✅ ON' : '❌ OFF'}
   .arm

🔹 *CALL REJECT:*  ${cfg.ANTI_CALL === 'on' ? '✅ ON' : '❌ OFF'}
   .creject

🔹 *MESSAGE READ:*  ${cfg.READ_COMMAND === 'true' ? '✅ ON' : '❌ OFF'}
   .mread

🔹 *PREFIX:*  ${cfg.PREFIX || '.'}
   .prefix <char>

🔹 *EMOJI MODE:*  ${cfg.EMOJIS === 'true' ? '✅ ON' : '❌ OFF'}
   .emojis

🔹 *BOT NAME:*  ${cfg.botName || 'DCT NINJA X MD'}
   .setbotname <name>

🔹 *LOGO:*  ${cfg.logo ? '✅ SET' : '❌ NOT SET'}
   Reply to image then .setlogo

═════════════════════════════════
🧚‍♂️ © 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳 🧚‍♂️
`;
            
            await socket.sendMessage(sender, { text: settingsPanel }, { quoted: msg });
          } catch (e) {
            console.error('settings error:', e);
            await socket.sendMessage(sender, { text: '❌ Error loading settings.' }, { quoted: msg });
          }
          break;
        }

        case 'channelfollowers':
        case 'channelinfo':
        case 'info': {
          try {
            const channelLink = args.join(' ') || 
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            if (!channelLink || !channelLink.trim()) {
              return await socket.sendMessage(sender, {
                text: `❌ *Channel Link Required!*\n\n📝 Usage: .channelinfo <channel_link>\n\n🔗 *Examples:*\n• .channelinfo https://whatsapp.com/channel/0029Vb7p3UCCHDyocfEGm23f\n• .channelinfo 120363423916773660@newsletter`
              }, { quoted: msg });
            }

            const channelJid = extractChannelId(channelLink.trim());
            if (!channelJid) {
              return await socket.sendMessage(sender, {
                text: `❌ *Invalid Channel Link!*\n\n🔗 Please provide a valid WhatsApp channel link or JID.`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: "📊", key: msg.key } });

            try {
              const channelInfo = await socket.newsletterMetadata(channelJid);
              const followersCount = channelInfo?.subscribers || 0;
              const channelName = channelInfo?.name || 'Unknown';
              const channelDesc = channelInfo?.description || 'No description';
              const creationTime = channelInfo?.creation_time ? new Date(channelInfo.creation_time * 1000).toLocaleString() : 'Unknown';

              const infoText = `📊 *CHANNEL INFORMATION* 📊

📺 *Channel Name:* ${channelName}
👥 *Followers:* ${followersCount.toLocaleString()}
🆔 *Channel JID:* ${channelJid}
📝 *Description:* ${channelDesc}
🕒 *Created:* ${creationTime}
🔗 *Link:* ${channelLink}

═══════════════════════
✨ *DCT NINJA X MD*
> Channel data retrieved successfully`;

              await socket.sendMessage(sender, { text: infoText }, { quoted: msg });

            } catch (infoError) {
              console.error('Channel info error:', infoError);
              await socket.sendMessage(sender, {
                text: `❌ *Failed to Get Channel Information!*\n\n📺 Channel: ${channelJid}\n⚠️ Error: ${infoError.message || 'Channel not found or access denied'}`
              }, { quoted: msg });
            }

          } catch (e) {
            console.error('Channel followers error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing channel info request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

        case 'followedchannels':
        case 'mychannels':
        case 'followed': {
          try {
            await socket.sendMessage(sender, { react: { text: "📋", key: msg.key } });

            try {
              const followedChannels = await listNewslettersFromMongo();

              if (!followedChannels || followedChannels.length === 0) {
                return await socket.sendMessage(sender, {
                  text: `📭 *No Followed Channels Found!*\n\n🤖 The bot is not following any channels currently.\n\n💡 Use .channelfollow <link> to follow channels.`
                }, { quoted: msg });
              }

              let channelsText = `📋 *FOLLOWED CHANNELS* 📋\n\n`;
              let totalFollowers = 0;

              for (let i = 0; i < followedChannels.length; i++) {
                const channel = followedChannels[i];
                try {
                  const channelInfo = await socket.newsletterMetadata(channel.jid);
                  const followers = channelInfo?.subscribers || 0;
                  const name = channelInfo?.name || 'Unknown';
                  totalFollowers += followers;

                  channelsText += `${i + 1}. 📺 *${name}*\n`;
                  channelsText += `   👥 Followers: ${followers.toLocaleString()}\n`;
                  channelsText += `   🆔 JID: ${channel.jid}\n`;
                  channelsText += `   🤖 Reactions: ${channel.emojis?.join(' ') || 'None'}\n\n`;
                } catch (infoError) {
                  channelsText += `${i + 1}. 📺 *Unknown Channel*\n`;
                  channelsText += `   🆔 JID: ${channel.jid}\n`;
                  channelsText += `   🤖 Reactions: ${channel.emojis?.join(' ') || 'None'}\n`;
                  channelsText += `   ⚠️ Info unavailable\n\n`;
                }
              }

              channelsText += `═══════════════════════\n`;
              channelsText += `📊 *Total Channels:* ${followedChannels.length}\n`;
              channelsText += `👥 *Total Followers:* ${totalFollowers.toLocaleString()}\n\n`;
              channelsText += `✨ *DCT NINJA X MD*`;

              await socket.sendMessage(sender, { text: channelsText }, { quoted: msg });

            } catch (listError) {
              console.error('List channels error:', listError);
              await socket.sendMessage(sender, {
                text: `❌ *Failed to List Followed Channels!*\n\n⚠️ Error: ${listError.message || 'Database error'}`
              }, { quoted: msg });
            }

          } catch (e) {
            console.error('Followed channels error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing followed channels request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

        case 'channelunfollow':
        case 'unfollowchannel':
        case 'unfollow': {
          try {
            const channelLink = args.join(' ') || 
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            if (!channelLink || !channelLink.trim()) {
              return await socket.sendMessage(sender, {
                text: `❌ *Channel Link Required!*\n\n📝 Usage: .unfollow <channel_link>\n\n🔗 *Examples:*\n• .unfollow https://whatsapp.com/channel/0029Vb7p3UCCHDyocfEGm23f\n• .unfollow 120363423916773660@newsletter`
              }, { quoted: msg });
            }

            const channelJid = extractChannelId(channelLink.trim());
            if (!channelJid) {
              return await socket.sendMessage(sender, {
                text: `❌ *Invalid Channel Link!*\n\n🔗 Please provide a valid WhatsApp channel link or JID.`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: "🔄", key: msg.key } });

            // Check if actually following
            try {
              const existingChannels = await listNewslettersFromMongo();
              const isFollowing = existingChannels.some(ch => ch.jid === channelJid);
              
              if (!isFollowing) {
                return await socket.sendMessage(sender, {
                  text: `⚠️ *Not Following This Channel!*\n\n📺 Channel: ${channelJid}\n❌ Bot is not following this channel.`
                }, { quoted: msg });
              }
            } catch (checkError) {
              console.log('Check existing channels error:', checkError);
              // Continue anyway
            }

            // Unfollow the channel
            try {
              await socket.newsletterUnfollow(channelJid);
              await socket.sendMessage(sender, {
                text: `✅ *Channel Unfollowed Successfully!*\n\n📺 Channel: ${channelJid}\n🔗 Link: ${channelLink}`
              }, { quoted: msg });
            } catch (unfollowError) {
              console.error('Channel unfollow error:', unfollowError);
              return await socket.sendMessage(sender, {
                text: `❌ *Failed to Unfollow Channel!*\n\n📺 Channel: ${channelJid}\n⚠️ Error: ${unfollowError.message || 'Unknown error'}`
              }, { quoted: msg });
            }

            // Remove from newsletter reacts in MongoDB
            try {
              await removeNewsletterFromMongo(channelJid);
              await socket.sendMessage(sender, {
                text: `🗑️ *Auto-Reaction Removed!*\n\n📺 Channel: ${channelJid}\n🤖 Bot will no longer react to messages from this channel.`
              }, { quoted: msg });
            } catch (removeError) {
              console.error('Remove newsletter error:', removeError);
              // Don't show error for this as unfollow already succeeded
            }

          } catch (e) {
            console.error('Channel unfollow error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing channel unfollow request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

        case 'channelfollow':
        case 'followchannel':
        case 'follow': {
          try {
            const channelLink = args.join(' ') || 
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            if (!channelLink || !channelLink.trim()) {
              return await socket.sendMessage(sender, {
                text: `❌ *Channel Link Required!*\n\n📝 Usage: .channelfollow <channel_link>\n\n🔗 *Examples:*\n• .channelfollow https://whatsapp.com/channel/0029VbBivQGBKfi1VaWyEd0t\n• .channelfollow 120363407179960904@newsletter\n• .channelfollow https://chat.whatsapp.com/channel/0029VbBivQGBKfi1VaWyEd0t`
              }, { quoted: msg });
            }

            const channelJid = extractChannelId(channelLink.trim());
            if (!channelJid) {
              return await socket.sendMessage(sender, {
                text: `❌ *Invalid Channel Link!*\n\n🔗 Please provide a valid WhatsApp channel link or JID.\n\n📝 *Supported formats:*\n• https://whatsapp.com/channel/...\n• https://chat.whatsapp.com/channel/...\n• 120363...@newsletter`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: "🔍", key: msg.key } });

            // Check if already following
            try {
              const existingChannels = await listNewslettersFromMongo();
              const alreadyFollowing = existingChannels.some(ch => ch.jid === channelJid);
              
              if (alreadyFollowing) {
                return await socket.sendMessage(sender, {
                  text: `⚠️ *Already Following This Channel!*\n\n📺 Channel: ${channelJid}\n✅ Bot is already following and reacting to messages.`
                }, { quoted: msg });
              }
            } catch (checkError) {
              console.log('Check existing channels error:', checkError);
              // Continue anyway
            }

            // Follow the channel
            try {
              await socket.newsletterFollow(channelJid);
              await socket.sendMessage(sender, {
                text: `✅ *Channel Followed Successfully!*\n\n📺 Channel: ${channelJid}\n🔗 Link: ${channelLink}`
              }, { quoted: msg });
            } catch (followError) {
              console.error('Channel follow error:', followError);
              return await socket.sendMessage(sender, {
                text: `❌ *Failed to Follow Channel!*\n\n📺 Channel: ${channelJid}\n⚠️ Error: ${followError.message || 'Unknown error'}\n\n💡 Make sure the channel exists and is public.`
              }, { quoted: msg });
            }

            // Get channel info and setup auto-reactions
            try {
              const channelInfo = await socket.newsletterMetadata(channelJid);
              const followersCount = channelInfo?.subscribers || 0;
              const channelName = channelInfo?.name || 'Unknown';

              await socket.sendMessage(sender, {
                text: `📊 *Channel Information*\n\n📺 *Name:* ${channelName}\n👥 *Followers:* ${followersCount.toLocaleString()}\n🆔 *JID:* ${channelJid}\n\n✅ *Bot is now following this channel and will react to all messages!*`
              }, { quoted: msg });

              // Set up auto-reaction for this channel
              const reactionEmojis = ['❤️', '👍', '🔥', '💯', '👏', '💙', '🩷', '💜', '🧡', '💛'];

              // Add to newsletter reacts in MongoDB
              await addNewsletterToMongo(channelJid, reactionEmojis);

              await socket.sendMessage(sender, {
                text: `🎯 *Auto-Reaction Setup Complete!*\n\n📺 Channel: ${channelName}\n🤖 Bot will react with: ${reactionEmojis.join(' ')}\n⏰ Reactions will be sent automatically to ALL new messages.\n\n💡 Use .unfollow <link> to stop following.`
              }, { quoted: msg });

            } catch (infoError) {
              console.error('Channel info error:', infoError);
              // Still add to reactions even if info fails
              const reactionEmojis = ['❤️', '👍', '🔥', '💯', '👏'];
              await addNewsletterToMongo(channelJid, reactionEmojis);
              
              await socket.sendMessage(sender, {
                text: `⚠️ *Channel followed but info unavailable*\n\n📺 Channel: ${channelJid}\n✅ Following active\n✅ Auto-reactions enabled\n❌ Could not retrieve channel details`
              }, { quoted: msg });
            }

          } catch (e) {
            console.error('Channel follow error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing channel follow request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

case 'song':
case 'play':
case 'audio':
case 'ytmp3': {
    try {
        const axios = require('axios');

        const BOT_NAME = "𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳";

        let text = (args.join(' ') || '').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text: "❌ *Give me a song name!*"
            }, { quoted: msg });
        }

        // 🎯 reaction
        await socket.sendMessage(sender, {
            react: { text: '🎧', key: msg.key }
        });

        // =========================
        // 🔎 SEARCH API
        // =========================
        const searchApi = `https://www.movanest.xyz/v2/ytsearch?query=${encodeURIComponent(text)}`;
        const searchRes = await axios.get(searchApi);

        const video = searchRes.data?.result?.[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: "❌ Song not found!"
            }, { quoted: msg });
        }

        const videoUrl = video.url || video.link;

        // =========================
        // UI MESSAGE
        // =========================
        const caption = `
╭───「 🎧 ${BOT_NAME} 」───◆
│
│ 🎵 Title : ${video.title}
│ ⏱️ Duration : ${video.duration}
│ 👁️ Views : ${video.views}
│
╰────────────────────◆

👉 Reply OR click button:
1️⃣ AUDIO
2️⃣ DOCUMENT
3️⃣ VOICE
`;

        // =========================
        // SEND BUTTON MESSAGE
        // =========================
        await socket.sendMessage(sender, {
            image: { url: video.thumbnail },
            caption,
            footer: BOT_NAME,
            buttons: [
                { buttonId: "song_audio", buttonText: { displayText: "🎧 AUDIO" }, type: 1 },
                { buttonId: "song_doc", buttonText: { displayText: "📂 DOCUMENT" }, type: 1 },
                { buttonId: "song_ptt", buttonText: { displayText: "🎤 VOICE" }, type: 1 }
            ],
            headerType: 4
        }, { quoted: msg });

        // =========================
        // LISTENER (BUTTON + NUMBER)
        // =========================
        const handler = async ({ messages }) => {
            const m = messages[0];
            if (!m?.message) return;

            if (m.key.remoteJid !== sender) return;

            let id =
                m.message?.buttonsResponseMessage?.selectedButtonId ||
                m.message?.templateButtonReplyMessage?.selectedId ||
                m.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;

            // parse interactive
            if (!id && typeof id === "string") {
                try {
                    id = JSON.parse(id)?.id;
                } catch {}
            }

            // number support
            const textMsg =
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "";

            if (!id && textMsg) {
                if (textMsg === "1") id = "song_audio";
                if (textMsg === "2") id = "song_doc";
                if (textMsg === "3") id = "song_ptt";
            }

            if (!id) return;

            let type = null;
            if (id === "song_audio") type = "audio";
            if (id === "song_doc") type = "doc";
            if (id === "song_ptt") type = "ptt";

            if (!type) return;

            socket.ev.off("messages.upsert", handler);

            await socket.sendMessage(sender, {
                react: { text: '⬇️', key: m.key }
            });

            try {
                // =========================
                // 🎧 DOWNLOAD API
                // =========================
                const dlApi = `https://www.movanest.xyz/v2/ytdl2?input=${encodeURIComponent(videoUrl)}&format=audio&bitrate=128`;

                const dlRes = await axios.get(dlApi);
                const downloadUrl = dlRes.data?.result?.download_url || dlRes.data?.download_url;

                if (!downloadUrl) throw new Error("Download URL not found");

                const audioBuffer = await axios.get(downloadUrl, {
                    responseType: "arraybuffer"
                });

                const buffer = Buffer.from(audioBuffer.data);

                // =========================
                // SEND MEDIA
                // =========================
                if (type === "doc") {
                    await socket.sendMessage(sender, {
                        document: buffer,
                        mimetype: "audio/mpeg",
                        fileName: `${video.title}.mp3`,
                        caption: `🎧 ${video.title}`
                    }, { quoted: m });

                } else if (type === "ptt") {
                    await socket.sendMessage(sender, {
                        audio: buffer,
                        mimetype: "audio/mpeg",
                        ptt: true
                    }, { quoted: m });

                } else {
                    await socket.sendMessage(sender, {
                        audio: buffer,
                        mimetype: "audio/mpeg"
                    }, { quoted: m });
                }

                await socket.sendMessage(sender, {
                    react: { text: '✅', key: m.key }
                });

            } catch (err) {
                console.log(err);
                await socket.sendMessage(sender, {
                    text: "❌ Download failed!"
                }, { quoted: m });
            }
        };

        socket.ev.on("messages.upsert", handler);

    } catch (e) {
        console.log(e);
        await socket.sendMessage(sender, {
            text: "❌ System error"
        }, { quoted: msg });
    }
    break;
}
          case 'youtube':
case 'ytdl':
case 'video':
case 'yt':
case 'mp4': {
    try {
        const axios = require('axios');

        const BOT_NAME = "𝙳𝙲𝚃 𝙽𝙸𝙽𝙹𝙰 𝚇 𝙼𝙳";

        let text = (args.join(' ') || '').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text: "❌ *Give YouTube name or link!*"
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: { text: '🔎', key: msg.key }
        });

        // =========================
        // 🔎 SEARCH API (MOVANEST)
        // =========================
        const searchApi = `https://www.movanest.xyz/v2/ytsearch?query=${encodeURIComponent(text)}`;
        const searchRes = await axios.get(searchApi);

        const video = searchRes.data?.result?.[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: "❌ Video not found!"
            }, { quoted: msg });
        }

        const videoUrl = video.url || video.link;

        // =========================
        // UI MESSAGE
        // =========================
        const caption = `
╭───「 🎬 ${BOT_NAME} 」───◆
│
│ 🎵 Title : ${video.title}
│ ⏱️ Duration : ${video.duration}
│ 👁️ Views : ${video.views}
│
╰────────────────────◆

👉 Reply or click:
1️⃣ 360P
2️⃣ 480P
3️⃣ 720P
4️⃣ AUDIO
`;

        // =========================
        // BUTTON MESSAGE
        // =========================
        await socket.sendMessage(sender, {
            image: { url: video.thumbnail },
            caption,
            footer: BOT_NAME,
            buttons: [
                { buttonId: "yt_360", buttonText: { displayText: "🎬 360P" }, type: 1 },
                { buttonId: "yt_480", buttonText: { displayText: "📹 480P" }, type: 1 },
                { buttonId: "yt_720", buttonText: { displayText: "🎥 720P" }, type: 1 },
                { buttonId: "yt_audio", buttonText: { displayText: "🎧 AUDIO" }, type: 1 }
            ],
            headerType: 4
        }, { quoted: msg });

        // =========================
        // LISTENER (BUTTON + NUMBER)
        // =========================
        const handler = async ({ messages }) => {
            const m = messages[0];
            if (!m?.message) return;
            if (m.key.remoteJid !== sender) return;

            let id =
                m.message?.buttonsResponseMessage?.selectedButtonId ||
                m.message?.templateButtonReplyMessage?.selectedId ||
                m.message?.extendedTextMessage?.text ||
                m.message?.conversation;

            // NUMBER SUPPORT
            if (id === "1") id = "yt_360";
            if (id === "2") id = "yt_480";
            if (id === "3") id = "yt_720";
            if (id === "4") id = "yt_audio";

            if (!id) return;

            let format = null;
            let type = "video";

            if (id === "yt_360") format = "360p";
            else if (id === "yt_480") format = "480p";
            else if (id === "yt_720") format = "720p";
            else if (id === "yt_audio") {
                format = "mp3";
                type = "audio";
            } else return;

            socket.ev.off("messages.upsert", handler);

            await socket.sendMessage(sender, {
                react: { text: '⬇️', key: m.key }
            });

            try {
                // =========================
                // 🎬 DOWNLOAD API (MOVANEST)
                // =========================
                const dlApi = `https://www.movanest.xyz/v2/ytdl2?input=${encodeURIComponent(videoUrl)}&format=${type === "audio" ? "audio" : "video"}&quality=${format}`;

                const dlRes = await axios.get(dlApi);

                const downloadUrl =
                    dlRes.data?.result?.download_url ||
                    dlRes.data?.result?.downloadLink ||
                    dlRes.data?.download_url;

                if (!downloadUrl) throw new Error("No download URL");

                const file = await axios.get(downloadUrl, {
                    responseType: "arraybuffer"
                });

                const buffer = Buffer.from(file.data);

                // =========================
                // SEND MEDIA
                // =========================
                if (type === "audio") {
                    await socket.sendMessage(sender, {
                        audio: buffer,
                        mimetype: "audio/mpeg",
                        ptt: false
                    }, { quoted: m });

                } else {
                    await socket.sendMessage(sender, {
                        video: buffer,
                        mimetype: "video/mp4",
                        caption: `🎬 *${video.title}*\n\n📥 Quality: ${format}\n🤖 ${BOT_NAME}`
                    }, { quoted: m });
                }

                await socket.sendMessage(sender, {
                    react: { text: '✅', key: m.key }
                });

            } catch (err) {
                console.log(err);
                await socket.sendMessage(sender, {
                    text: "❌ Download failed. Try another quality."
                }, { quoted: m });
            }
        };

        socket.ev.on("messages.upsert", handler);

    } catch (e) {
        console.log(e);
        await socket.sendMessage(sender, {
            text: "❌ System Error"
        }, { quoted: msg });
    }
    break;
}

case 'tt':
case 'tiktokdl': {
  const q = args.join(' ') ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const url = q.trim();
  if (!url) {
    return await socket.sendMessage(sender, {
      text: '*📌 Usage:* .tt <tiktok_url>\n*Example:* .tt https://vt.tiktok.com/ZS57nHKP8/'
    }, { quoted: msg });
  }

  if (!url.includes('tiktok.com') && !url.includes('vt.tiktok')) {
    return await socket.sendMessage(sender, {
      text: '❌ *Invalid TikTok URL.*\nඔබ TikTok video link එකක් දෙන්න ඕනෙ!'
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(sender, {
      text: '*⏳ Downloading your TikTok video...*'
    }, { quoted: msg });

    const downloadUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
    const response = await axios.get(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    const data = response.data;
    if (data.code !== 0 || !data.data) {
      throw new Error(data.msg || 'Failed to fetch video');
    }

    const videoData = data.data;
    const videoUrl = videoData.hdplay || videoData.play || videoData.wm || videoData.download;
    if (!videoUrl) {
      throw new Error('No video URL found');
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;

    const caption = `*${botName} 𝗧ɪᴋᴛᴏᴋ 𝗗ᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n` +
      `*┏━━━━━━━━━━━◆◉◉➤*\n` +
      `*┃📝 𝗧ɪᴛʟᴇ:* ${videoData.title || 'No Title'}\n` +
      `*┃👤 𝗔ᴜᴛʜᴏʀ:* ${videoData.author?.nickname || 'Unknown'}\n` +
      `*┃👍 𝗟ɪᴋᴇꜱ:* ${videoData.digg_count || 0}\n` +
      `*┃💬 𝗖ᴏᴍᴍᴇɴᴛꜱ:* ${videoData.comment_count || 0}\n` +
      `*┃🔁 𝗦ʜᴀʀᴇꜱ:* ${videoData.share_count || 0}\n` +
      `*┃📥 𝗗ᴏᴡɴʟᴏᴀᴅ:* ${videoData.download_count || 0}\n` +
      `*┗━━━━━━━━━━━◆◉◉➤*\n\n` +
      `> *© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳*`;

    await socket.sendMessage(sender, {
      video: { url: videoUrl },
      caption: caption,
      gifPlayback: false
    }, { quoted: msg });
  } catch (error) {
    console.error('TikTok Download Error:', error);
    try {
      await socket.sendMessage(sender, {
        text: '*🔄 Trying alternative method...*'
      }, { quoted: msg });
      const altResponse = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`);
      const altData = altResponse.data;
      if (altData.data && altData.data.play) {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || BOT_NAME_FANCY;
        const caption = `*${botName} 𝗧ɪᴋᴛᴛᴏᴋ 𝗗ᴏᴡɴʟᴏᴀᴅᴇʀ*\n\nTitle: ${altData.data.title || 'No Title'}\nAuthor: ${altData.data.author?.nickname || 'Unknown'}`;
        await socket.sendMessage(sender, {
          video: { url: altData.data.play },
          caption: caption
        }, { quoted: msg });
      } else {
        throw new Error('Alternative API also failed');
      }
    } catch (altError) {
      console.error('Alternative API Error:', altError);
      await socket.sendMessage(sender, {
        text: `❌ *Download Failed!*\n\nError: ${error.message}\n\nඔබට අවශ්‍ය නම්:\n1. TikTok link එක නිවැරදිද බලන්න\n2. Video එක public එකක්ද බලන්න\n3. නැත්තම් නැවත උත්සාහ කරන්න`
      }, { quoted: msg });
    }
  }
  break;
}

case 'fb':
case 'fbdl':
case 'facebook':
case 'fbd': {
  try {
    const url = args[0] || '';
    if (!url) {
      return await socket.sendMessage(sender, {
        text: '🚫 *Please send a Facebook video link.*\n\nExample: .fb <url>'
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_FB"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    let api = `https://tharuzz-ofc-api-v2.vercel.app/api/download/fbdl?url=${encodeURIComponent(url)}`;
    let { data } = await axios.get(api);

    if (!data.success || !data.result) {
      return await socket.sendMessage(sender, { text: '❌ *Failed to fetch Facebook video.*' }, { quoted: shonux });
    }

    let title = data.result.title || 'Facebook Video';
    let thumb = data.result.thumbnail;
    let hdLink = data.result.dlLink?.hdLink || data.result.dlLink?.sdLink;

    if (!hdLink) {
      return await socket.sendMessage(sender, { text: '⚠️ *No video link available.*' }, { quoted: shonux });
    }

    await socket.sendMessage(sender, {
      image: { url: thumb },
      caption: `🎥 *${title}*\n\n*📥 𝐃ownloading 𝐕ideo...*\n> *${botName}*`
    }, { quoted: shonux });

    await socket.sendMessage(sender, {
      video: { url: hdLink },
      caption: `🎥 *${title}*\n\n> *${botName}*`
    }, { quoted: shonux });
  } catch (e) {
    console.log(e);
    await socket.sendMessage(sender, { text: '⚠️ *Error downloading Facebook video.*' });
  }
  break;
}

case 'mediafire':
case 'mf':
case 'mfdl': {
  try {
    const url = args[0] || '';
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;

    if (!url) {
      return await socket.sendMessage(sender, {
        text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
      }, { quoted: msg });
    }

    await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
    await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: msg });

    let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
    let { data } = await axios.get(api);

    if (!data.success || !data.result) {
      return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: msg });
    }

    const result = data.result;
    const title = result.title || result.filename;
    const filename = result.filename;
    const fileSize = result.size;
    const downloadUrl = result.url;

    const caption = `📦 *${title}*\n\n` +
      `📁 *ꜰɪʟᴇɴᴀᴍᴇ :* ${filename}\n` +
      `📏 *ꜱɪᴢᴇ :* ${fileSize}\n` +
      `🌐 *ꜰʀᴏᴍ :* ${result.from}\n` +
      `📅 *ᴅᴀᴛᴇ :* ${result.date}\n` +
      `🕑 *ᴛɪᴍᴇ :* ${result.time}\n\n` +
      `> *© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳*`;

    await socket.sendMessage(sender, {
      document: { url: downloadUrl },
      fileName: filename,
      mimetype: 'application/octet-stream',
      caption: caption
    }, { quoted: msg });
  } catch (err) {
    console.error("Error in MediaFire downloader:", err);
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_MEDIAFIRE"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
  }
  break;
}

case 'apkdownload':
case 'apk': {
  try {
    const id = args[0] || '';
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_APKDL"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    if (!id) {
      return await socket.sendMessage(sender, {
        text: '🚫 *Please provide an APK package ID.*\n\nExample: .apkdownload com.whatsapp',
        buttons: [
          { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📄 𝗠ᴇɴᴜ' }, type: 1 }
        ]
      }, { quoted: shonux });
    }

    await socket.sendMessage(sender, { text: '*⏳ Fetching APK info...*' }, { quoted: shonux });

    const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/download/apkdownload?id=${encodeURIComponent(id)}`;
    const { data } = await axios.get(apiUrl);

    if (!data.success || !data.result) {
      return await socket.sendMessage(sender, { text: '*❌ Failed to fetch APK info.*' }, { quoted: shonux });
    }

    const result = data.result;
    const caption = `📱 *${result.name}*\n\n` +
      `*🆔 𝗣ᴀᴄᴋᴀɢᴇ:* \`${result.package}\`\n` +
      `*📦 𝗦ɪᴢᴇ:* ${result.size}\n` +
      `*🕒 𝗟ᴀꜱᴛ 𝗨ᴘᴅᴀᴛᴇ:* ${result.lastUpdate}\n\n` +
      `> *${botName}*`;

    await socket.sendMessage(sender, {
      document: { url: result.dl_link },
      fileName: `${result.name}.apk`,
      mimetype: 'application/vnd.android.package-archive',
      caption: caption,
      jpegThumbnail: result.image ? await axios.get(result.image, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
    }, { quoted: shonux });
  } catch (err) {
    console.error("Error in APK download:", err);
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_APKDL"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
  }
  break;
}

/* =========================
   🔙 BACK
========================= */
case 'menu_back': {
  await socket.sendMessage(sender, {
    text: "🔙 Back to main menu → type .menu"
  });
  break;
        }

        // ==================== CINESUBZ COMMAND ====================
        case 'cinesubz': {
          const axios = require('axios');
          const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
          const query = q.replace(/^\.cinesubz\s*/i, '').trim();
          if (!query) return await socket.sendMessage(sender, { text: '❎ Please enter a movie name! Example: .cinesubz Avatar' }, { quoted: msg });
          const API_KEY = 'acd388d0c4350c90';
          const BASE_URL = 'https://api-dark-shan-yt.koyeb.app/movie';
          await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
          try {
            const searchUrl = `${BASE_URL}/cinesubz-search?q=${encodeURIComponent(query)}&apikey=${API_KEY}`;
            const searchRes = await axios.get(searchUrl);
            if (!searchRes.data?.status || !searchRes.data.data?.length) return await socket.sendMessage(sender, { text: '❎ No results found.' }, { quoted: msg });
            const results = searchRes.data.data.slice(0, 5);
            const firstImage = results[0].image;
            const resultsList = results.map((movie, i) => { const title = movie.title.split('|')[0].trim(); return `*${i + 1} ┃ ${title}*\n   🎬 Movie • ${movie.quality || 'N/A'}`; }).join('\n\n');
            const searchCaption = `🎬 𝗖ɪɴᴇꜱᴜʙᴢ 𝗥ᴇꜱᴜʟᴛꜱ 🎬\n\n${resultsList}\n\n> *© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳*`;
            const searchMsg = await socket.sendMessage(sender, { image: { url: firstImage }, caption: searchCaption }, { quoted: msg });
            let step = 'movie', lastMsgId = searchMsg.key.id, selectedMovie = null, downloads = null, finalUrl = null, selectedQuality = null, movieTitle = '', timeout = null;
            const handler = async (msgUpdate) => {
              try {
                const received = msgUpdate.messages[0];
                if (!received) return;
                const fromId = received.key.remoteJid || received.key.participant;
                if (fromId !== sender) return;
                const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (!quotedId || quotedId !== lastMsgId) return;
                const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
                if (!text) return;
                const choice = parseInt(text.trim());
                if (isNaN(choice)) { await socket.sendMessage(sender, { text: '❎ Please enter a valid number.' }, { quoted: received }); return; }
                await socket.sendMessage(sender, { react: { text: '🔍', key: received.key } });
                if (step === 'movie') {
                  if (choice < 1 || choice > results.length) { await socket.sendMessage(sender, { text: `❎ Select a valid number (1-${results.length})` }, { quoted: received }); return; }
                  selectedMovie = results[choice - 1];
                  movieTitle = selectedMovie.title.split('|')[0].trim();
                  const infoUrl = `${BASE_URL}/cinesubz-info?url=${encodeURIComponent(selectedMovie.link)}&apikey=${API_KEY}`;
                  const infoRes = await axios.get(infoUrl);
                  if (!infoRes.data?.status || !infoRes.data.data?.downloads) { await socket.sendMessage(sender, { text: '❎ No download links found for this movie.' }, { quoted: received }); cleanup(); return; }
                  downloads = infoRes.data.data.downloads;
                  const info = infoRes.data.data;
                  const qualityList = downloads.map((q, i) => { return `*${i + 1} ┃📥 ${q.quality} • ${q.size} • ${q.language || 'English'}*`; }).join('\n\n');
                  const qualityCaption = `*🎬 𝗖ɪɴᴇꜱᴜʙᴢ 𝗜ɴꜰᴏ 🎬*\n*🎬 𝗧ɪᴛʟᴇ*: ${movieTitle}\n*⭐ 𝗥ᴀᴛɪɴɢ*: ${info.rating || 'N/A'}\n*📅 𝗬ᴇᴀʀ*: ${info.year || 'N/A'}\n*⏱️ 𝗗ᴜʀᴀᴛɪᴏɴ*: ${info.duration || 'N/A'}\n\n🔢 *𝗥ᴇᴘʟʏ 𝗪ɪᴛʜ ᴀ 𝗡ᴜ𝗺𝗯𝗲𝗿* 👇\n\n${qualityList}\n\n> *© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳*`;
                  const qualityMsg = await socket.sendMessage(sender, { image: { url: selectedMovie.image }, caption: qualityCaption }, { quoted: received });
                  step = 'quality'; lastMsgId = qualityMsg.key.id;
                } else if (step === 'quality') {
                  if (!downloads || choice < 1 || choice > downloads.length) { await socket.sendMessage(sender, { text: `❎ Select a valid number (1-${downloads.length})` }, { quoted: received }); return; }
                  selectedQuality = downloads[choice - 1];
                  const downloadUrl = `${BASE_URL}/cinesubz-download?url=${encodeURIComponent(selectedQuality.link)}&apikey=${API_KEY}`;
                  const downloadRes = await axios.get(downloadUrl);
                  if (!downloadRes.data?.status || !downloadRes.data.data?.download) { await socket.sendMessage(sender, { text: '❎ Failed to retrieve the download link.' }, { quoted: received }); cleanup(); return; }
                  const downloadInfo = downloadRes.data.data.download;
                  const directItem = downloadInfo.find(d => d.name === 'unknown') || downloadInfo[0];
                  finalUrl = directItem.url;
                  const formatCaption = `╭〔 🎬 𝗖ɪɴᴇꜱᴜʙᴢ 𝗗ᴏᴡɴʟᴏᴀᴅ ✨ 〕\n│ 🎬 *Title*: ${movieTitle}\n│ 💿 *Quality*: ${selectedQuality.quality}\n│ 📦 *Size*: ${selectedQuality.size}\n╰──────────\n\n🔢 *Reply with a number to choose format* 👇\n\n*1 ┃📽️ Video Format*\n*2 ┃📁 Document Format*\n\n> *© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳*`;
                  const formatMsg = await socket.sendMessage(sender, { image: { url: selectedMovie.image }, caption: formatCaption }, { quoted: received });
                  step = 'format'; lastMsgId = formatMsg.key.id;
                } else if (step === 'format') {
                  if (choice < 1 || choice > 2) { await socket.sendMessage(sender, { text: '❎ Please select 1 (Video) or 2 (Document).' }, { quoted: received }); return; }
                  await socket.sendMessage(sender, { react: { text: '📦', key: received.key } });
                  const fileName = `${movieTitle} [${selectedQuality.quality}] CineSubz.mp4`;
                  if (choice === 2) await socket.sendMessage(sender, { document: { url: finalUrl }, mimetype: 'video/mp4', fileName: fileName, caption: `*${movieTitle}*\n\n> _© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳 ||🎬_` }, { quoted: received });
                  else await socket.sendMessage(sender, { video: { url: finalUrl }, caption: `*${movieTitle}*\n\n> * _© 𝙳𝙲𝚃 𝙽𝚒𝚗𝚓𝚊 𝚇 𝙼𝙳 ||🎬_*` }, { quoted: received });
                  await socket.sendMessage(sender, { react: { text: '✅', key: received.key } });
                  cleanup();
                }
              } catch (err) { console.error('CineSubz handler error:', err); cleanup(); }
            };
            const cleanup = () => { if (timeout) clearTimeout(timeout); socket.ev.off('messages.upsert', handler); };
            socket.ev.on('messages.upsert', handler);
            timeout = setTimeout(() => cleanup(), 60 * 1000);
          } catch (err) { console.error('CineSubz case error:', err); await socket.sendMessage(sender, { text: `❌ ERROR: ${err.message}` }, { quoted: msg }); }
          break;
        }

        // ==================== BAISCOPES COMMAND ====================
        case 'baiscopes': {
          const axios = require('axios');
          try {
            const q = args.join(' ').trim();
            if (!q) return socket.sendMessage(sender, { text: '❎ Please enter a movie name!\n\nExample: .baiscopes Superman' }, { quoted: msg });
            await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });
            const searchApi = `https://api-dark-shan-yt.koyeb.app/movie/baiscopes-search?q=${encodeURIComponent(q)}&apikey=acd388d0c4350c90`;
            const { data } = await axios.get(searchApi);
            if (!data?.status || !data.data || data.data.length === 0) return socket.sendMessage(sender, { text: '❎ No Baiscopes results found!' }, { quoted: msg });
            const results = data.data.slice(0, 5);
            for (let i = 0; i < results.length; i++) {
              const movie = results[i];
              const caption = `*${i + 1}.* 🎬 ${movie.title}\n💬 Reply with *${i + 1}* to select this movie.`;
              await socket.sendMessage(sender, { image: { url: movie.imageUrl }, caption }, { quoted: msg });
            }
            await socket.sendMessage(sender, { text: `💬 Now reply with the number of the movie you want to see download links for.` }, { quoted: msg });
            const movieSelectListener = async (update) => {
              const m = update.messages[0];
              if (!m?.message?.conversation) return;
              if (m.key.remoteJid !== sender) return;
              const choice = parseInt(m.message.conversation.trim());
              if (isNaN(choice) || choice < 1 || choice > results.length) return;
              const selected = results[choice - 1];
              if (!selected) return;
              await socket.sendMessage(sender, { react: { text: '⏳', key: m.key } });
              const infoApi = `https://api-dark-shan-yt.koyeb.app/movie/baiscopes-search?q=${encodeURIComponent(selected.link)}&apikey=acd388d0c4350c90`;
              const { data: infoData } = await axios.get(infoApi);
              if (!infoData?.status || !infoData.data) return socket.sendMessage(sender, { text: '❎ Failed to get movie info.' }, { quoted: m });
              const info = infoData.data;
              let dlText = `🎬 *${info.movieInfo.title}*\n📅 Release: ${info.movieInfo.releaseDate}\n🕒 Runtime: ${info.movieInfo.runtime}\n🌍 Country: ${info.movieInfo.country}\n⭐ IMDb: ${info.movieInfo.ratingValue}\n\n💬 Reply with the number to download:\n\n`;
              info.downloadLinks.forEach((dl, i) => { dlText += `*${i + 1}.* ${dl.quality} (${dl.size})\n`; });
              await socket.sendMessage(sender, { image: { url: info.movieInfo.galleryImages[0] }, caption: dlText }, { quoted: m });
              const dlListener = async (dlUpdate) => {
                const d = dlUpdate.messages[0];
                if (!d?.message?.conversation) return;
                if (d.key.remoteJid !== sender) return;
                const dlChoice = parseInt(d.message.conversation.trim());
                if (isNaN(dlChoice) || dlChoice < 1 || dlChoice > info.downloadLinks.length) return;
                const dlObj = info.downloadLinks[dlChoice - 1];
                if (!dlObj) return;
                await socket.sendMessage(sender, { react: { text: '⬇️', key: d.key } });
                await socket.sendMessage(sender, { document: { url: dlObj.directLinkUrl }, mimetype: 'video/mp4', fileName: `${info.movieInfo.title} (${dlObj.quality}).mp4`, caption: `🎬 *${info.movieInfo.title}*\n⭐ Quality: ${dlObj.quality}\n📦 Size: ${dlObj.size}\n\n✅ Download Successful` }, { quoted: d });
                await socket.sendMessage(sender, { react: { text: '✅', key: d.key } });
                socket.ev.off('messages.upsert', dlListener);
              };
              socket.ev.on('messages.upsert', dlListener);
              socket.ev.off('messages.upsert', movieSelectListener);
            };
            socket.ev.on('messages.upsert', movieSelectListener);
          } catch (err) { console.error(err); await socket.sendMessage(sender, { text: `❌ ERROR: ${err.message}` }, { quoted: msg }); }
          break;
        }
        
        
        // ---------- UNKNOWN COMMAND ----------
        default: {
          await socket.sendMessage(sender, { text: `❌ Unknown command: ${command}\n\nType *${config.PREFIX}menu* to see all available commands.` });
          break;
        }
      }
      
    } catch (err) {
      console.error('Command handler error:', err);
      try {
        await socket.sendMessage(msg.key.remoteJid, { text: '❌ An error occurred while processing your command.' });
      } catch (e) { }
    }
  });
}

// ==================== EXPRESS ENDPOINTS ====================

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try { await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try { await removeNewsletterFromMongo(jid); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.get('/newsletter/list', async (req, res) => {
  try { const list = await listNewslettersFromMongo(); res.status(200).send({ status: 'ok', channels: list }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try { await addAdminToMongo(jid); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try { await removeAdminFromMongo(jid); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.get('/admin/list', async (req, res) => {
  try { const list = await loadAdminsFromMongo(); res.status(200).send({ status: 'ok', admins: list }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getSriLankaTimestamp() });
});

router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: 'DCT NINJA X MD BOT', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
      await EmpirePair(number, mockRes);
      results.push({ number, status: 'connection_initiated' });
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});

router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
      try { await EmpirePair(number, mockRes); results.push({ number, status: 'connection_initiated' }); } catch (err) { results.push({ number, status: 'failed', error: err.message }); }
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});

router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});

router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});

// ==================== CLEANUP ====================

process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) { }
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch (e) { }
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

initMongo().catch(err => console.warn('Mongo init failed at startup', err));

// Auto reconnect existing sessions on startup
(async () => {
  try {
    const nums = await getAllNumbersFromMongo();
    if (nums && nums.length) {
      console.log(`Found ${nums.length} sessions to reconnect...`);
      for (const n of nums) {
        if (!activeSockets.has(n)) {
          console.log(`Reconnecting session ${n}...`);
          const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
          await EmpirePair(n, mockRes);
          await delay(2000);
        }
      }
    }
  } catch (e) { console.error('Auto reconnect error:', e); }
})();

module.exports = router;
