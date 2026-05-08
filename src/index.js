export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      const update = await request.json();

      // 1. Handle Commands
      if (update.message?.text?.startsWith("/")) {
        ctx.waitUntil(handleCommand(update.message, env));
        return new Response("OK", { status: 200 });
      }

      // 2. Handle Inline Bot Messages
      const msg = update.message;
      if (msg?.via_bot) {
        ctx.waitUntil(processInlineMessage(msg, env));
      }
    } catch (error) {
      console.error("Worker error:", error);
    }

    return new Response("OK", { status: 200 });
  },
};

async function processInlineMessage(msg, env) {
  const viaBotUsername = msg.via_bot.username.toLowerCase();
  
  // Get whitelist from KV
  const whitelistStr = await env.WHITELIST_KV.get("whitelist") || "";
  const allowedBots = new Set(
    whitelistStr.split(",").map(b => b.trim().toLowerCase()).filter(Boolean)
  );

  // Delete if NOT whitelisted
  if (!allowedBots.has(viaBotUsername)) {
    await apiRequest(env.TELEGRAM_BOT_TOKEN, "deleteMessage", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
    });
  }
}

async function handleCommand(msg, env) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  // Security Check: Admin only
  const isAdmin = await checkAdminPermissions(token, chatId, userId);
  if (!isAdmin) return;

  const parts = text.split(/\s+/);
  const action = parts[1]?.toLowerCase();
  const targetBot = parts[2]?.replace(/^@/, "").toLowerCase();

  let responseText = "";
  
  // Fetch current list from KV
  let whitelistStr = await env.WHITELIST_KV.get("whitelist") || "";
  let list = whitelistStr ? whitelistStr.split(",").map(s => s.trim()) : [];

  if (action === "add" && targetBot) {
    if (!list.includes(targetBot)) {
      list.push(targetBot);
      await saveWhitelist(env, list);
      responseText = `@${targetBot} добавлен в белый список`;
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
    } else {
      responseText = `@${targetBot} не в белом списке`;
    }
  } 
  else if (action === "list") {
    if (list.length === 0) {
      responseText = "Empty";
    } else {
      // Returns: @gif, @vid, @sticker
      responseText = list.map(b => `@${b}`).join(", ");
    }
  } 
  else {
    responseText = "Use: /whitelist add/remove/list @bot";
  }

  // Reply with short message containing target
  await apiRequest(token, "sendMessage", {
    chat_id: chatId,
    text: responseText,
    reply_to_message_id: msg.message_id,
  });
}

async function saveWhitelist(env, list) {
  const cleanList = list.filter(Boolean);
  await env.WHITELIST_KV.put("whitelist", cleanList.join(","));
}

async function checkAdminPermissions(token, chatId, userId) {
  try {
    const res = await apiRequest(token, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
    
    if (!res.ok) return false;
    
    const member = res.result;
    if (member.status === "creator") return true;
    if (member.status === "administrator" && member.can_delete_messages) return true;
    
    return false;
  } catch (e) {
    return false;
  }
}

async function apiRequest(token, method, params) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return await response.json();
}