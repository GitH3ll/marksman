/**
 * Telegram Whitelist Bot - Cloudflare Worker
 * Handles /whitelist commands and auto-deletes non-whitelisted inline bot messages
 * 
 * Required env vars:
 * - TELEGRAM_BOT_TOKEN: Your bot's API token
 * - WHITELIST_KV: KV namespace binding for storing allowed bots
 */

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const clientIP = request.headers.get('cf-connecting-ip') || 'unknown';
    
    console.log(`[REQUEST] ${request.method} ${url.pathname} from ${clientIP}`);

    if (request.method !== "POST") {
      console.log(`[SKIP] Non-POST request, returning 200`);
      return new Response("OK", { status: 200 });
    }

    try {
      const update = await request.json();
      const updateType = update.message ? 'message' : update.callback_query ? 'callback' : 'unknown';
      const chatId = update.message?.chat?.id || 'N/A';
      const userId = update.message?.from?.id || 'N/A';
      
      console.log(`[UPDATE] Type: ${updateType}, Chat: ${chatId}, User: ${userId}`);

      // 1. Handle Commands
      if (update.message?.text?.startsWith("/")) {
        const command = update.message.text.split(/\s+/)[0];
        console.log(`[COMMAND] Received: "${command}" in chat ${chatId}`);
        
        ctx.waitUntil(
          handleCommand(update.message, env)
            .then(() => console.log(`[COMMAND] Completed: "${command}"`))
            .catch(err => console.error(`[COMMAND] Failed:`, err.message, { 
              command, chatId, stack: err.stack 
            }))
        );
        return new Response("OK", { status: 200 });
      }

      // 2. Handle Inline Bot Messages
      const msg = update.message;
      if (msg?.via_bot) {
        const botUsername = msg.via_bot.username;
        console.log(`[INLINE] Message via @${botUsername}, chat: ${msg.chat.id}, msg_id: ${msg.message_id}`);
        
        ctx.waitUntil(
          processInlineMessage(msg, env)
            .then(() => console.log(`[INLINE] Processed @${botUsername}`))
            .catch(err => console.error(`[INLINE] Failed for @${botUsername}:`, err.message, { 
              chatId: msg.chat.id, messageId: msg.message_id, stack: err.stack 
            }))
        );
      }

    } catch (error) {
      console.error(`[FATAL] Request processing failed:`, {
        error: error.message,
        stack: error.stack,
        url: request.url,
        method: request.method
      });
    }

    const duration = Date.now() - startTime;
    console.log(`[REQUEST] Completed in ${duration}ms`);
    return new Response("OK", { status: 200 });
  },
};

// ============================================================================
// MESSAGE PROCESSING
// ============================================================================

async function processInlineMessage(msg, env) {
  const viaBotUsername = msg.via_bot.username.toLowerCase();
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  
  console.log(`[WHITELIST] Checking @${viaBotUsername} for chat ${chatId}`);

  try {
    const whitelistStr = await env.WHITELIST_KV.get("whitelist");
    console.log(`[KV] Read whitelist: ${whitelistStr ? 'found' : 'empty/not found'}`);
    
    const allowedBots = new Set(
      (whitelistStr || "").split(",").map(b => b.trim().toLowerCase()).filter(Boolean)
    );

    if (!allowedBots.has(viaBotUsername)) {
      console.log(`[ACTION] @${viaBotUsername} not whitelisted, deleting message ${messageId}`);
      
      const deleteResult = await apiRequest(env.TELEGRAM_BOT_TOKEN, "deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
      
      if (deleteResult.ok) {
        console.log(`[SUCCESS] Message ${messageId} deleted`);
      } else {
        console.warn(`[WARN] Telegram API deleteMessage failed:`, { 
          status: deleteResult.error_code, 
          description: deleteResult.description,
          chatId, messageId 
        });
      }
    } else {
      console.log(`[SKIP] @${viaBotUsername} is whitelisted, keeping message`);
    }
  } catch (error) {
    console.error(`[ERROR] processInlineMessage failed:`, {
      message: error.message, stack: error.stack, viaBot: viaBotUsername, chatId, messageId
    });
    throw error;
  }
}

// ============================================================================
// COMMAND HANDLING
// ============================================================================

async function handleCommand(msg, env) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  // Telegram uses 1087968824 for all anonymous admin messages
  const isAnonymous = msg.from?.id === 1087968824;
  const userIdToCheck = isAnonymous ? msg.sender_chat?.id : msg.from?.id;
  const senderLabel = isAnonymous 
    ? `anonymous_admin(chat:${msg.sender_chat?.id})` 
    : `user:${msg.from?.id}(@${msg.from?.username || 'no-username'})`;

  console.log(`[CMD-HANDLE] ${senderLabel} in chat ${chatId}: "${text}"`);

  if (!userIdToCheck) {
    console.warn(`[AUTH] Cannot determine sender identity`, { from: msg.from, sender_chat: msg.sender_chat });
    return;
  }

  try {
    console.log(`[AUTH] Checking admin permissions for ${senderLabel} in chat ${chatId}`);
    const isAdmin = await checkAdminPermissions(token, chatId, userIdToCheck, isAnonymous);
    
    if (!isAdmin) {
      console.warn(`[AUTH] Denied: ${senderLabel} lacks admin permissions in chat ${chatId}`);
      return;
    }
    console.log(`[AUTH] Granted: ${senderLabel} has admin permissions`);

    const parts = text.split(/\s+/);
    const action = parts[1]?.toLowerCase();
    const targetBot = parts[2]?.replace(/^@/, "").toLowerCase();
    
    console.log(`[CMD] Action: "${action}", Target: "${targetBot || 'N/A'}"`);

    let whitelistStr = await env.WHITELIST_KV.get("whitelist");
    let list = whitelistStr ? whitelistStr.split(",").map(s => s.trim()) : [];
    console.log(`[KV] Current whitelist: [${list.join(', ')}]`);

    let responseText = "";
    
    if (action === "add" && targetBot) {
      if (!list.includes(targetBot)) {
        list.push(targetBot);
        await saveWhitelist(env, list);
        responseText = `@${targetBot} добавлен в белый список`;
        console.log(`[CMD] Added @${targetBot} to whitelist`);
      } else {
        responseText = `@${targetBot} уже в белом списке`;
      }
    } 
    else if (action === "remove" && targetBot) {
      const initialLen = list.length;
      list = list.filter(b => b !== targetBot);
      
      if (list.length < initialLen) {
        await saveWhitelist(env, list);
        responseText = `@${targetBot} удалён из белого списка`;
        console.log(`[CMD] Removed @${targetBot} from whitelist`);
      } else {
        responseText = `@${targetBot} не в белом списке`;
      }
    } 
    else if (action === "list") {
      responseText = list.length === 0 ? "Empty" : list.map(b => `@${b}`).join(", ");
      console.log(`[CMD] Returning whitelist: ${responseText}`);
    } 
    else {
      responseText = "Use: /whitelist add/remove/list @bot";
      console.log(`[CMD] Invalid usage, sending help`);
    }

    const replyChatId = isAnonymous && msg.sender_chat?.id ? msg.sender_chat.id : chatId;
    const replyParams = {
      chat_id: replyChatId,
      text: responseText,
      reply_to_message_id: msg.message_id,
      disable_notification: isAnonymous,
    };

    console.log(`[REPLY] Sending to chat ${replyChatId}: "${responseText}"`);
    const replyResult = await apiRequest(token, "sendMessage", replyParams);

    if (replyResult.ok) {
      console.log(`[REPLY] Message sent successfully`);
    } else {
      console.warn(`[WARN] Telegram API sendMessage failed:`, { 
        status: replyResult.error_code, description: replyResult.description 
      });
    }
    
  } catch (error) {
    console.error(`[ERROR] handleCommand failed:`, {
      message: error.message, stack: error.stack, chatId, sender: senderLabel, command: text
    });
    throw error;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

async function saveWhitelist(env, list) {
  const cleanList = list.filter(Boolean);
  const listStr = cleanList.join(",");
  console.log(`[KV] Writing whitelist: [${listStr || 'empty'}]`);
  
  try {
    await env.WHITELIST_KV.put("whitelist", listStr);
    console.log(`[KV] Write successful`);
  } catch (error) {
    console.error(`[KV] Write failed:`, error.message, { attemptedList: listStr });
    throw error;
  }
}

/**
 * Check admin permissions.
 * NOTE: Telegram's API does not support verifying anonymous admins via getChatMember.
 * We trust them because Telegram only allows group admins to post anonymously.
 */
async function checkAdminPermissions(token, chatId, userId, isAnonymous = false) {
  if (isAnonymous) {
    console.log(`[AUTH] Anonymous admin detected. Trusting as admin (Telegram restricts anonymous posting to admins only).`);
    return true;
  }

  try {
    console.log(`[API] Calling getChatMember for user ID ${userId} in chat ${chatId}`);
    
    const res = await apiRequest(token, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
    
    if (!res.ok) {
      console.warn(`[API] getChatMember returned error:`, { 
        error_code: res.error_code, description: res.description, chatId, userId 
      });
      return false;
    }
    
    const member = res.result;
    const isAdmin = member.status === "creator" || 
                   (member.status === "administrator" && member.can_delete_messages);
    
    console.log(`[API] User ${userId} - status: ${member.status}, can_delete: ${member.can_delete_messages}, isAdmin: ${isAdmin}`);
    return isAdmin;
    
  } catch (e) {
    console.error(`[API] getChatMember request failed:`, e.message, { chatId, userId });
    return false;
  }
}

async function apiRequest(token, method, params) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const startTime = Date.now();
  
  console.log(`[API-REQ] ${method}`, { params: Object.keys(params) });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'N/A');
      console.error(`[API-ERR] ${method} failed: HTTP ${response.status}`, {
        duration: `${duration}ms`, error: errorText.substring(0, 300), method, params
      });
      try { return JSON.parse(errorText); } 
      catch { return { ok: false, error_code: response.status, description: errorText }; }
    }
    
    const result = await response.json();
    console.log(`[API-OK] ${method} completed in ${duration}ms`, { ok: result.ok, hasResult: !!result.result });
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[API-NET] ${method} network error:`, { message: error.message, duration: `${duration}ms`, method, params });
    throw error;
  }
}