// ============================================
// DATABASE LAYER — PostgreSQL with In-Memory Fallback
// ============================================

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
});

let useMemoryDb = false;

pool.on('error', (err) => {
  if (!useMemoryDb) {
    console.error('❌ PostgreSQL pool error:', err.message);
  }
});

// ============================================
// IN-MEMORY DATABASE MOCK (Local Dev Fallback)
// ============================================

interface MemoryUser {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'user' | 'analyst' | 'admin';
  avatar_color: string;
  created_at: string;
  last_seen: string;
  is_online: boolean;
}

interface MemoryChat {
  id: number;
  user_id: number;
  agent_id: string;
  status: 'ai' | 'waiting' | 'human' | 'closed';
  assigned_analyst_id: number | null;
  subject?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  rating?: number | null;
  feedback_text?: string | null;
}

interface MemoryMessage {
  id: number;
  chat_id: number;
  sender_type: 'user' | 'ai' | 'analyst' | 'system';
  sender_id: number | null;
  sender_name: string;
  text: string;
  created_at: string;
  is_read: boolean;
}

interface MemoryFeedback {
  id: number;
  user_id: number | null;
  user_name: string;
  agent_id: string;
  agent_name: string;
  rating: number;
  text: string | null;
  topic: string | null;
  created_at: string;
}

const memoryDb = {
  users: [] as MemoryUser[],
  chats: [] as MemoryChat[],
  messages: [] as MemoryMessage[],
  feedbacks: [] as MemoryFeedback[],
  nextUserId: 1,
  nextChatId: 1,
  nextMessageId: 1,
  nextFeedbackId: 1,
};

// ============================================
// SCHEMA INITIALIZATION
// ============================================

export async function initDatabase(): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'analyst', 'admin')),
          avatar_color VARCHAR(50) DEFAULT '#4ade80',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_seen TIMESTAMPTZ DEFAULT NOW(),
          is_online BOOLEAN DEFAULT false
        );

        CREATE TABLE IF NOT EXISTS chats (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          agent_id VARCHAR(50) DEFAULT 'salesforce',
          status VARCHAR(20) DEFAULT 'ai' CHECK (status IN ('ai', 'waiting', 'human', 'closed')),
          assigned_analyst_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          subject VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          closed_at TIMESTAMPTZ,
          rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
          feedback_text TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
          sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'ai', 'analyst', 'system')),
          sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          sender_name VARCHAR(255) NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          is_read BOOLEAN DEFAULT false
        );

        CREATE TABLE IF NOT EXISTS feedbacks (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          user_name VARCHAR(255) NOT NULL,
          agent_id VARCHAR(50) NOT NULL,
          agent_name VARCHAR(255) NOT NULL,
          rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
          text TEXT,
          topic VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
        CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
        CREATE INDEX IF NOT EXISTS idx_chats_analyst ON chats(assigned_analyst_id);
        CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks(created_at);
      `);
      useMemoryDb = false;
      console.log('✅ PostgreSQL conectado e schema inicializado.');
    } finally {
      client.release();
    }
  } catch (err: any) {
    useMemoryDb = true;
    console.warn('⚠️ PostgreSQL não detectado na porta 5432 (Docker desativado ou não instalado).');
    console.warn('⚡ Modo de desenvolvimento ativado com Banco de Dados em Memória (tudo funciona normalmente!).\n');
  }
}

// ============================================
// USER QUERIES
// ============================================

export async function createUser(
  name: string,
  email: string,
  passwordHash: string,
  role?: string
) {
  const colors = ['#4ade80', '#60a5fa', '#c084fc', '#f59e0b', '#f87171', '#34d399', '#a78bfa'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  if (useMemoryDb) {
    // First user is automatically admin
    const isFirstUser = memoryDb.users.length === 0;
    const finalRole = isFirstUser ? 'admin' : (role || 'user');

    const user: MemoryUser = {
      id: memoryDb.nextUserId++,
      name,
      email,
      password_hash: passwordHash,
      role: finalRole as any,
      avatar_color: color,
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      is_online: false,
    };
    memoryDb.users.push(user);
    const { password_hash, ...safeUser } = user;
    return safeUser;
  }

  // PostgreSQL check for first user
  const countRes = await pool.query('SELECT COUNT(*)::int as count FROM users');
  const isFirstUser = countRes.rows[0].count === 0;
  const finalRole = isFirstUser ? 'admin' : (role || 'user');

  const res = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, avatar_color)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, avatar_color, created_at`,
    [name, email, passwordHash, finalRole, color]
  );
  return res.rows[0];
}

export async function getAllUsers() {
  if (useMemoryDb) {
    return memoryDb.users.map(({ password_hash, ...safe }) => safe);
  }
  const res = await pool.query(
    'SELECT id, name, email, role, avatar_color, created_at, last_seen, is_online FROM users ORDER BY id ASC'
  );
  return res.rows;
}

export async function updateUserRole(userId: number, newRole: string) {
  if (!['user', 'analyst', 'admin'].includes(newRole)) {
    throw new Error('Perfil inválido');
  }

  if (useMemoryDb) {
    const user = memoryDb.users.find(u => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado');
    user.role = newRole as any;
    const { password_hash, ...safe } = user;
    return safe;
  }

  const res = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role, avatar_color',
    [newRole, userId]
  );
  if (res.rows.length === 0) throw new Error('Usuário não encontrado');
  return res.rows[0];
}

export async function deleteUser(userId: number) {
  if (useMemoryDb) {
    const idx = memoryDb.users.findIndex(u => u.id === userId);
    if (idx === -1) throw new Error('Usuário não encontrado');
    memoryDb.users.splice(idx, 1);
    return { success: true };
  }

  const res = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
  if (res.rows.length === 0) throw new Error('Usuário não encontrado');
  return { success: true };
}

export async function resetUserPassword(userId: number, newPasswordHash: string) {
  if (useMemoryDb) {
    const user = memoryDb.users.find(u => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado');
    user.password_hash = newPasswordHash;
    return { success: true };
  }

  const res = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id', [newPasswordHash, userId]);
  if (res.rows.length === 0) throw new Error('Usuário não encontrado');
  return { success: true };
}

export async function getUserByEmail(email: string) {
  if (useMemoryDb) {
    return memoryDb.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return res.rows[0] || null;
}

export async function getUserById(id: number) {
  if (useMemoryDb) {
    const u = memoryDb.users.find(user => user.id === id);
    if (!u) return null;
    const { password_hash, ...safe } = u;
    return safe;
  }
  const res = await pool.query(
    'SELECT id, name, email, role, avatar_color, created_at, last_seen, is_online FROM users WHERE id = $1',
    [id]
  );
  return res.rows[0] || null;
}

export async function setUserOnline(id: number, online: boolean) {
  if (useMemoryDb) {
    const u = memoryDb.users.find(user => user.id === id);
    if (u) {
      u.is_online = online;
      u.last_seen = new Date().toISOString();
    }
    return;
  }
  await pool.query(
    'UPDATE users SET is_online = $1, last_seen = NOW() WHERE id = $2',
    [online, id]
  );
}

export async function getOnlineAnalysts() {
  if (useMemoryDb) {
    return memoryDb.users
      .filter(u => (u.role === 'analyst' || u.role === 'admin') && u.is_online)
      .map(({ password_hash, ...safe }) => safe);
  }
  const res = await pool.query(
    `SELECT id, name, email, role, is_online FROM users
     WHERE role IN ('analyst', 'admin') AND is_online = true`
  );
  return res.rows;
}

// ============================================
// CHAT QUERIES
// ============================================

export async function createChat(userId: number, agentId: string = 'salesforce') {
  if (useMemoryDb) {
    const chat: MemoryChat = {
      id: memoryDb.nextChatId++,
      user_id: userId,
      agent_id: agentId,
      status: 'ai',
      assigned_analyst_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryDb.chats.push(chat);
    return chat;
  }
  const res = await pool.query(
    `INSERT INTO chats (user_id, agent_id, status)
     VALUES ($1, $2, 'ai') RETURNING *`,
    [userId, agentId]
  );
  return res.rows[0];
}

export async function getChatById(chatId: number) {
  if (useMemoryDb) {
    const chat = memoryDb.chats.find(c => c.id === chatId);
    if (!chat) return null;
    const user = memoryDb.users.find(u => u.id === chat.user_id);
    const analyst = chat.assigned_analyst_id ? memoryDb.users.find(u => u.id === chat.assigned_analyst_id) : null;
    return {
      ...chat,
      user_name: user?.name,
      user_email: user?.email,
      analyst_name: analyst?.name,
    };
  }
  const res = await pool.query(
    `SELECT c.*, u.name as user_name, u.email as user_email,
            a.name as analyst_name
     FROM chats c
     LEFT JOIN users u ON c.user_id = u.id
     LEFT JOIN users a ON c.assigned_analyst_id = a.id
     WHERE c.id = $1`,
    [chatId]
  );
  return res.rows[0] || null;
}

export async function getActiveChatsForUser(userId: number) {
  if (useMemoryDb) {
    return memoryDb.chats
      .filter(c => c.user_id === userId && c.status !== 'closed')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .map(c => {
        const msgs = memoryDb.messages.filter(m => m.chat_id === c.id);
        const lastMsg = msgs[msgs.length - 1]?.text || '';
        const unread = msgs.filter(m => !m.is_read && m.sender_type !== 'user').length;
        return { ...c, last_message: lastMsg, unread_count: unread };
      });
  }
  const res = await pool.query(
    `SELECT c.*, 
       (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
       (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND is_read = false AND sender_type != 'user')::int as unread_count
     FROM chats c
     WHERE c.user_id = $1 AND c.status != 'closed'
     ORDER BY c.updated_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function getPendingChats() {
  if (useMemoryDb) {
    return memoryDb.chats
      .filter(c => c.status === 'waiting')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(c => {
        const user = memoryDb.users.find(u => u.id === c.user_id);
        const msgs = memoryDb.messages.filter(m => m.chat_id === c.id);
        return {
          ...c,
          user_name: user?.name,
          user_email: user?.email,
          last_message: msgs[msgs.length - 1]?.text || '',
          message_count: msgs.length,
        };
      });
  }
  const res = await pool.query(
    `SELECT c.*, u.name as user_name, u.email as user_email,
       (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
       (SELECT COUNT(*)::int FROM messages WHERE chat_id = c.id) as message_count
     FROM chats c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.status = 'waiting'
     ORDER BY c.created_at ASC`
  );
  return res.rows;
}

export async function getAnalystActiveChats(analystId: number) {
  if (useMemoryDb) {
    return memoryDb.chats
      .filter(c => c.assigned_analyst_id === analystId && c.status === 'human')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .map(c => {
        const user = memoryDb.users.find(u => u.id === c.user_id);
        const msgs = memoryDb.messages.filter(m => m.chat_id === c.id);
        const unread = msgs.filter(m => !m.is_read && m.sender_type === 'user').length;
        return {
          ...c,
          user_name: user?.name,
          user_email: user?.email,
          last_message: msgs[msgs.length - 1]?.text || '',
          unread_count: unread,
        };
      });
  }
  const res = await pool.query(
    `SELECT c.*, u.name as user_name, u.email as user_email,
       (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
       (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND is_read = false AND sender_type = 'user')::int as unread_count
     FROM chats c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.assigned_analyst_id = $1 AND c.status = 'human'
     ORDER BY c.updated_at DESC`,
    [analystId]
  );
  return res.rows;
}

export async function updateChatStatus(
  chatId: number,
  status: string,
  analystId?: number | null
) {
  if (useMemoryDb) {
    const chat = memoryDb.chats.find(c => c.id === chatId);
    if (chat) {
      chat.status = status as any;
      chat.updated_at = new Date().toISOString();
      if (analystId !== undefined) chat.assigned_analyst_id = analystId;
      if (status === 'closed') chat.closed_at = new Date().toISOString();
    }
    return;
  }

  const updates = ['status = $1', 'updated_at = NOW()'];
  const params: any[] = [status];
  let paramIdx = 2;

  if (analystId !== undefined) {
    updates.push(`assigned_analyst_id = $${paramIdx}`);
    params.push(analystId);
    paramIdx++;
  }

  if (status === 'closed') {
    updates.push('closed_at = NOW()');
  }

  params.push(chatId);
  await pool.query(
    `UPDATE chats SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
    params
  );
}

export async function rateChatAndClose(
  chatId: number,
  rating: number,
  feedbackText?: string
) {
  if (useMemoryDb) {
    const chat = memoryDb.chats.find(c => c.id === chatId);
    if (chat) {
      chat.status = 'closed';
      chat.closed_at = new Date().toISOString();
      chat.updated_at = new Date().toISOString();
      chat.rating = rating;
      chat.feedback_text = feedbackText || null;
    }
    return;
  }
  await pool.query(
    `UPDATE chats SET status = 'closed', closed_at = NOW(), updated_at = NOW(),
     rating = $1, feedback_text = $2 WHERE id = $3`,
    [rating, feedbackText || null, chatId]
  );
}

// ============================================
// MESSAGE QUERIES
// ============================================

export async function addMessage(
  chatId: number,
  senderType: string,
  senderId: number | null,
  senderName: string,
  text: string
) {
  if (useMemoryDb) {
    const msg: MemoryMessage = {
      id: memoryDb.nextMessageId++,
      chat_id: chatId,
      sender_type: senderType as any,
      sender_id: senderId,
      sender_name: senderName,
      text,
      created_at: new Date().toISOString(),
      is_read: false,
    };
    memoryDb.messages.push(msg);
    const chat = memoryDb.chats.find(c => c.id === chatId);
    if (chat) chat.updated_at = new Date().toISOString();
    return msg;
  }

  const res = await pool.query(
    `INSERT INTO messages (chat_id, sender_type, sender_id, sender_name, text)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [chatId, senderType, senderId, senderName, text]
  );
  await pool.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);
  return res.rows[0];
}

export async function getMessages(chatId: number, limit: number = 100) {
  if (useMemoryDb) {
    return memoryDb.messages
      .filter(m => m.chat_id === chatId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, limit);
  }

  const res = await pool.query(
    `SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [chatId, limit]
  );
  return res.rows;
}

export async function markMessagesRead(chatId: number, readerType: string) {
  if (useMemoryDb) {
    const excludeType = readerType === 'user' ? 'user' : 'analyst';
    memoryDb.messages.forEach(m => {
      if (m.chat_id === chatId && m.sender_type !== excludeType) {
        m.is_read = true;
      }
    });
    return;
  }

  const excludeType = readerType === 'user' ? 'user' : 'analyst';
  await pool.query(
    `UPDATE messages SET is_read = true
     WHERE chat_id = $1 AND sender_type != $2 AND is_read = false`,
    [chatId, excludeType]
  );
}

// ============================================
// FEEDBACK QUERIES
// ============================================

export async function saveFeedback(data: {
  userId?: number;
  userName: string;
  agentId: string;
  agentName: string;
  rating: number;
  text?: string;
  topic?: string;
}) {
  if (useMemoryDb) {
    const fb: MemoryFeedback = {
      id: memoryDb.nextFeedbackId++,
      user_id: data.userId || null,
      user_name: data.userName,
      agent_id: data.agentId,
      agent_name: data.agentName,
      rating: data.rating,
      text: data.text || null,
      topic: data.topic || null,
      created_at: new Date().toISOString(),
    };
    memoryDb.feedbacks.push(fb);
    return fb;
  }

  const res = await pool.query(
    `INSERT INTO feedbacks (user_id, user_name, agent_id, agent_name, rating, text, topic)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.userId || null, data.userName, data.agentId, data.agentName, data.rating, data.text || null, data.topic || null]
  );
  return res.rows[0];
}

export async function getAllFeedbacks(limit: number = 50) {
  if (useMemoryDb) {
    return memoryDb.feedbacks
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  const res = await pool.query(
    'SELECT * FROM feedbacks ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return res.rows;
}

// ============================================
// ANALYTICS QUERIES
// ============================================

export async function getAnalyticsStats(periodDays?: number) {
  if (useMemoryDb) {
    const totalChats = memoryDb.chats.length;
    const closed = memoryDb.chats.filter(c => c.status === 'closed').length;
    const aiActive = memoryDb.chats.filter(c => c.status === 'ai').length;
    const waiting = memoryDb.chats.filter(c => c.status === 'waiting').length;
    const humanActive = memoryDb.chats.filter(c => c.status === 'human').length;

    const ratedChats = memoryDb.chats.filter(c => c.rating != null);
    const avgRating = ratedChats.length > 0
      ? ratedChats.reduce((sum, c) => sum + (c.rating || 0), 0) / ratedChats.length
      : 0;

    const totalFb = memoryDb.feedbacks.length;
    const positiveFb = memoryDb.feedbacks.filter(f => f.rating >= 4).length;
    const fbAvgRating = totalFb > 0
      ? memoryDb.feedbacks.reduce((sum, f) => sum + f.rating, 0) / totalFb
      : 0;

    const resolvedByAi = memoryDb.chats.filter(c => c.status === 'closed' && !c.assigned_analyst_id).length;
    const resolvedByHuman = memoryDb.chats.filter(c => c.status === 'closed' && c.assigned_analyst_id).length;

    return {
      chats: { total: totalChats, closed, ai_active: aiActive, waiting, human_active: humanActive },
      rating: { avg_rating: avgRating, rated_count: ratedChats.length },
      feedbacks: { total: totalFb, avg_rating: fbAvgRating, positive: positiveFb },
      messages: { total: memoryDb.messages.length },
      resolution: { resolved_by_ai: resolvedByAi, resolved_by_human: resolvedByHuman },
    };
  }

  const whereClause = periodDays
    ? `WHERE c.created_at >= NOW() - INTERVAL '${periodDays} days'`
    : '';
  const feedbackWhere = periodDays
    ? `WHERE created_at >= NOW() - INTERVAL '${periodDays} days'`
    : '';

  const chatsRes = await pool.query(
    `SELECT COUNT(*)::int as total,
       COUNT(CASE WHEN status = 'closed' THEN 1 END)::int as closed,
       COUNT(CASE WHEN status = 'ai' THEN 1 END)::int as ai_active,
       COUNT(CASE WHEN status = 'waiting' THEN 1 END)::int as waiting,
       COUNT(CASE WHEN status = 'human' THEN 1 END)::int as human_active
     FROM chats c ${whereClause}`
  );

  const ratingRes = await pool.query(
    `SELECT AVG(rating)::float as avg_rating,
       COUNT(rating)::int as rated_count
     FROM chats c
     ${whereClause ? whereClause + ' AND' : 'WHERE'} rating IS NOT NULL`
  );

  const fbRes = await pool.query(
    `SELECT COUNT(*)::int as total,
       AVG(rating)::float as avg_rating,
       COUNT(CASE WHEN rating >= 4 THEN 1 END)::int as positive
     FROM feedbacks ${feedbackWhere}`
  );

  const msgRes = await pool.query(
    `SELECT COUNT(*)::int as total FROM messages m
     JOIN chats c ON m.chat_id = c.id ${whereClause}`
  );

  const resolutionRes = await pool.query(
    `SELECT 
       COUNT(CASE WHEN status = 'closed' AND assigned_analyst_id IS NULL THEN 1 END)::int as resolved_by_ai,
       COUNT(CASE WHEN status = 'closed' AND assigned_analyst_id IS NOT NULL THEN 1 END)::int as resolved_by_human
     FROM chats c ${whereClause}`
  );

  return {
    chats: chatsRes.rows[0],
    rating: ratingRes.rows[0],
    feedbacks: fbRes.rows[0],
    messages: msgRes.rows[0],
    resolution: resolutionRes.rows[0],
  };
}

export async function getChatsByPeriod(periodDays: number) {
  if (useMemoryDb) {
    const map: Record<string, number> = {};
    memoryDb.chats.forEach(c => {
      const dateStr = c.created_at.split('T')[0];
      map[dateStr] = (map[dateStr] || 0) + 1;
    });
    return Object.entries(map).map(([date, count]) => ({ date, count }));
  }

  const res = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*)::int as count
     FROM chats
     WHERE created_at >= NOW() - INTERVAL '${periodDays} days'
     GROUP BY DATE(created_at)
     ORDER BY date ASC`
  );
  return res.rows;
}

export { pool };
