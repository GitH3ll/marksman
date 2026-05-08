
export async function saveWhitelist(env, list, chatId) {
  const cleanList = list.filter(Boolean);
  const listStr = cleanList.join(",");
  const whitelistKey = String(chatId);
  console.log(`[KV] Writing whitelist for chat ${chatId}: [${listStr || 'empty'}]`);
  
  try {
    await env.WHITELIST_KV.put(whitelistKey, listStr);
    console.log(`[KV] Write successful`);
  } catch (error) {
    console.error(`[KV] Write failed:`, error.message, { attemptedList: listStr, chatId });
    throw error;
  }
}

/**
 * Parse a duration string like "1d2h30m" into total seconds.
 * Returns null if the format is invalid.
 */
export function parseDuration(durationStr) {
  const regex = /^(\d+d)?(\d+h)?(\d+m)?$/;
  const match = durationStr.match(regex);
  if (!match) return null;
  const days = parseInt(match[1]) || 0;
  const hours = parseInt(match[2]) || 0;
  const minutes = parseInt(match[3]) || 0;
  if (days === 0 && hours === 0 && minutes === 0) return null;
  return (days * 86400) + (hours * 3600) + (minutes * 60);
}

/**
 * Check admin permissions.
 * NOTE: Telegram's API does not support verifying anonymous admins via getChatMember.
 * We trust them because Telegram only allows group admins to post anonymously.
 *
 * @param {string} token - Telegram bot token
 * @param {number|string} chatId - Chat ID
 * @param {number|string} userId - User ID to check
 * @param {boolean} [isAnonymous=false] - Whether the user is an anonymous admin
 * @param {string[]} [requiredPermissions=['can_delete_messages']] - List of required admin permissions
 * @returns {Promise<boolean>} - Whether the user has all required permissions
 */
export async function checkAdminPermissions(token, chatId, userId, isAnonymous = false, requiredPermissions = ['can_delete_messages']) {
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
    
    // Creator has all permissions
    if (member.status === "creator") {
      console.log(`[API] User ${userId} - status: creator, has all permissions`);
      return true;
    }
    
    // Administrator must have all required permissions
    if (member.status === "administrator") {
      const hasAllPermissions = requiredPermissions.every(perm => member[perm] === true);
      console.log(`[API] User ${userId} - status: administrator, required: [${requiredPermissions.join(', ')}], hasAll: ${hasAllPermissions}`);
      return hasAllPermissions;
    }
    
    console.log(`[API] User ${userId} - status: ${member.status}, not admin`);
    return false;
    
  } catch (e) {
    console.error(`[API] getChatMember request failed:`, e.message, { chatId, userId });
    return false;
  }
}

export async function apiRequest(token, method, params) {
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
