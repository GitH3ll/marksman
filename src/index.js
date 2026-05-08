async function handleCommand(msg, env) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  // Determine who to check permissions for
  const isAnonymous = msg.from?.id === 1087968824; // Telegram's anonymous admin ID
  const userIdToCheck = isAnonymous ? msg.sender_chat?.id : msg.from?.id;
  const senderLabel = isAnonymous 
    ? `anonymous_admin(chat:${msg.sender_chat?.id})` 
    : `user:${msg.from?.id}(@${msg.from?.username})`;

  console.log(`[CMD-HANDLE] ${senderLabel} in chat ${chatId}: "${text}"`);

  if (!userIdToCheck) {
    console.warn(`[AUTH] Cannot determine sender identity for permission check`, { 
      from: msg.from, 
      sender_chat: msg.sender_chat 
    });
    return;
  }

  try {
    // Security Check: Admin only (check against the correct ID)
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

    // Reply: use sender_chat.id if anonymous admin, else from.id
    const replyChatId = isAnonymous && msg.sender_chat?.id ? msg.sender_chat.id : chatId;
    const replyParams = {
      chat_id: replyChatId,
      text: responseText,
      reply_to_message_id: msg.message_id,
    };
    
    // For anonymous admin replies in supergroups, you may need to disable notification
    if (isAnonymous) {
      replyParams.disable_notification = true;
    }

    console.log(`[REPLY] Sending response to chat ${replyChatId}: "${responseText}"`);
    const replyResult = await apiRequest(token, "sendMessage", replyParams);

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
      sender: senderLabel,
      command: text
    });
    throw error;
  }
}

async function checkAdminPermissions(token, chatId, userId, isAnonymous = false) {
  try {
    console.log(`[API] Calling getChatMember for ${isAnonymous ? 'sender_chat' : 'user'} ID ${userId} in chat ${chatId}`);
    
    const res = await apiRequest(token, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
    
    if (!res.ok) {
      console.warn(`[API] getChatMember returned error:`, res, { chatId, userId });
      return false;
    }
    
    const member = res.result;
    
    // For anonymous admins, the "user" is actually a chat (channel/supergroup)
    if (isAnonymous) {
      // Anonymous admins appear as "administrator" with special flags
      const isAdmin = member.status === "administrator" && member.can_delete_messages;
      console.log(`[API] Anonymous sender status: ${member.status}, can_delete: ${member.can_delete_messages}, isAdmin: ${isAdmin}`);
      return isAdmin;
    }
    
    // Regular user check
    const isAdmin = member.status === "creator" || 
                   (member.status === "administrator" && member.can_delete_messages);
    
    console.log(`[API] User ${userId} status: ${member.status}, isAdmin: ${isAdmin}`);
    return isAdmin;
    
  } catch (e) {
    console.error(`[API] getChatMember request failed:`, e.message, { chatId, userId });
    return false;
  }
}