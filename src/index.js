export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    
    // Basic request logging
    console.log(`[REQUEST] ${request.method} ${url.pathname} from ${request.headers.get('cf-connecting-ip') || 'unknown'}`);

    if (request.method !== "POST") {
      console.log(`[SKIP] Non-POST request, returning 200`);
      return new Response("OK", { status: 200 });
    }

    try {
      const update = await request.json();
      const updateType = update.message ? 'message' : update.callback_query ? 'callback' : 'unknown';
      console.log(`[UPDATE] Type: ${updateType}, Chat: ${update.message?.chat?.id || 'N/A'}, User: ${update.message?.from?.id || 'N/A'}`);

      // 1. Handle Commands
      if (update.message?.text?.startsWith("/")) {
        const command = update.message.text.split(/\s+/)[0];
        console.log(`[COMMAND] Received: "${command}" in chat ${update.message.chat.id}`);
        
        ctx.waitUntil(
          handleCommand(update.message, env)
            .then(() => console.log(`[COMMAND] Completed successfully`))
            .catch(err => console.error(`[COMMAND] Failed:`, err.message, { command, chatId: update.message.chat.id }))
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
            .catch(err => console.error(`[INLINE] Failed for @${botUsername}:`, err.message, { chatId: msg.chat.id, messageId: msg.message_id }))
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

async function processInlineMessage(msg, env) {
  const viaBotUsername = msg.via_bot.username.toLowerCase();
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  
  console.log(`[WHITELIST] Checking @${viaBotUsername} for chat ${chatId}`);

  try {
    // Get whitelist from KV
    const whitelistStr = await env.WHITELIST_KV.get("whitelist");
    console.log(`[KV] Read whitelist: ${whitelistStr ? 'found' : 'empty/not found'}`);
    
    const allowedBots = new Set(
      (whitelistStr || "").split(",").map(b => b.trim().toLowerCase()).filter(Boolean)
    );

    // Delete if NOT whitelisted
    if (!allowedBots.has(viaBotUsername)) {
      console.log(`[ACTION] @${viaBotUsername} not whitelisted, deleting message ${messageId}`);
      
      const deleteResult = await apiRequest(env.TELEGRAM_BOT_TOKEN, "deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
      
      if (deleteResult.ok) {
        console.log(`[SUCCESS] Message ${messageId} deleted`);
      } else {
        console.warn(`[WARN] Telegram API delete failed:`, deleteResult, { chatId, messageId });
      }
    } else {
      console.log(`[SKIP] @${viaBotUsername} is whitelisted, keeping message`);
    }
  } catch (error) {
    console.error(`[ERROR] processInlineMessage failed:`, {
      message: error.message,
      viaBot: viaBotUsername,
      chatId,
      messageId
    });
    throw error; // Re-throw so caller can handle
  }
}

async function handleCommand(msg, env) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || 'N/A';
  const text = msg.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  console.log(`[CMD-HANDLE] User @${username} (${userId}) in chat ${chatId}: "${text}"`);

  try {
    // Security Check: Admin only
    console.log(`[AUTH] Checking admin permissions for user ${userId} in chat ${chatId}`);
    const isAdmin = await checkAdminPermissions(token, chatId, userId);
    
    if (!isAdmin) {
      console.warn(`[AUTH] Denied: user ${userId} is not admin in chat ${chatId}`);
      return;
    }
    console.log(`[AUTH] Granted: user ${userId} has admin permissions`);

    const parts = text.split(/\s+/);
    const action = parts[1]?.toLowerCase();
    const targetBot = parts[2]?.replace(/^@/, "").toLowerCase();
    
    console.log(`[CMD] Action: "${action}", Target: "${targetBot || 'N/A'}"`);

    // Fetch current list from KV
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
        console.log(`[CMD] @${targetBot} already in whitelist`);
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
        console.log(`[CMD] @${targetBot} not found in whitelist`);
      }
    } 
    else if (action === "list") {
      if (list.length === 0) {
        responseText = "Empty";
      } else {
        responseText = list.map(b => `@${b}`).join(", ");
      }
      console.log(`[CMD] Returning whitelist: ${responseText}`);
    } 
    else {
      responseText = "Use: /whitelist add/remove/list @bot";
      console.log(`[CMD] Invalid usage, sending help`);
    }

    // Reply with message
    console.log(`[REPLY] Sending response to chat ${chatId}: "${responseText}"`);
    const replyResult = await apiRequest(token, "sendMessage", {
      chat_id: chatId,
      text: responseText,
      reply_to_message_id: msg.message_id,
    });

    if (replyResult.ok) {
      console.log(`[REPLY] Message sent successfully`);
    } else {
      console.warn(`[WARN] Telegram API sendMessage failed:`, replyResult);
    }
    
  } catch (error) {
    console.error(`[ERROR] handleCommand failed:`, {
      message: error.message,
      stack: error.stack,
      chatId,
      userId,
      command: text
    });
    throw error;
  }
}

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

async function checkAdminPermissions(token, chatId, userId) {
  try {
    console.log(`[API] Calling getChatMember for user ${userId} in chat ${chatId}`);
    
    const res = await apiRequest(token, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
    
    if (!res.ok) {
      console.warn(`[API] getChatMember returned error:`, res);
      return false;
    }
    
    const member = res.result;
    const isAdmin = member.status === "creator" || 
                   (member.status === "administrator" && member.can_delete_messages);
    
    console.log(`[API] User ${userId} status: ${member.status}, isAdmin: ${isAdmin}`);
    return isAdmin;
    
  } catch (e) {
    console.error(`[API] getChatMember request failed:`, e.message, { chatId, userId });
    return false;
  }
}

async function apiRequest(token, method, params) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const startTime = Date.now();
  
  // Log request (mask token)
  console.log(`[API-REQ] ${method} to Telegram API`, { 
    params: Object.keys(params), 
    // Avoid logging sensitive IDs in plain text if needed
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    
    const duration = Date.now() - startTime;
    const contentType = response.headers.get('content-type') || '';
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'N/A');
      console.error(`[API-ERR] ${method} failed: HTTP ${response.status} ${response.statusText}`, {
        duration: `${duration}ms`,
        errorBody: errorText.substring(0, 200), // Truncate long errors
        params
      });
      // Try to parse as JSON for better error info
      try {
        return JSON.parse(errorText);
      } catch {
        return { ok: false, error: errorText };
      }
    }
    
    const result = await response.json();
    console.log(`[API-OK] ${method} completed in ${duration}ms`, { 
      ok: result.ok,
      hasResult: !!result.result 
    });
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[API-NET] ${method} network error:`, {
      message: error.message,
      duration: `${duration}ms`,
      params
    });
    throw error;
  }
}