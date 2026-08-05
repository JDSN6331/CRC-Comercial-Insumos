// ============================================
// CRC COMERCIAL INSUMOS — Express Server
// ============================================

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  initDatabase, createUser, getUserByEmail, getUserById,
  getActiveChatsForUser, getAllFeedbacks, saveFeedback,
  getAnalyticsStats, getChatsByPeriod, getPendingChats,
  getAllUsers, updateUserRole, deleteUser, resetUserPassword,
} from './db.js';
import { setupSocketHandlers } from './socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || '3001');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================
// EXPRESS SETUP
// ============================================

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: NODE_ENV === 'development' ? ['http://localhost:5173', 'http://localhost:3001'] : false,
    credentials: true,
  },
});

app.use(cors({
  origin: NODE_ENV === 'development' ? 'http://localhost:5173' : false,
  credentials: true,
}));
app.use(express.json());

// ============================================
// AUTH MIDDLEWARE
// ============================================

function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function analystMiddleware(req: any, res: any, next: any) {
  if (req.user?.role !== 'analyst' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a analistas' });
  }
  next();
}

function adminMiddleware(req: any, res: any, next: any) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

// Health Check Endpoint for Docker / Easypanel
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// AUTH ROUTES
// ============================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    // Validate email domain
    if (!email.endsWith('@cooxupe.com.br')) {
      return res.status(400).json({ error: 'Apenas emails @cooxupe.com.br são permitidos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    // Check existing
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Este email já está cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser(name, email, passwordHash);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color },
    });
  } catch (err: any) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color },
    });
  } catch (err: any) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req: any, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================
// CHAT ROUTES (REST — complement to Socket.io)
// ============================================

app.get('/api/chats', authMiddleware, async (req: any, res) => {
  try {
    const chats = await getActiveChatsForUser(req.user.id);
    res.json({ chats });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao buscar chats' });
  }
});

app.get('/api/chats/pending', authMiddleware, analystMiddleware, async (req: any, res) => {
  try {
    const chats = await getPendingChats();
    res.json({ chats });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao buscar fila' });
  }
});

// ============================================
// ANALYTICS ROUTES (Admin Only)
// ============================================

app.get('/api/analytics/stats', authMiddleware, adminMiddleware, async (req: any, res) => {
  try {
    const period = req.query.period as string;
    let periodDays: number | undefined;
    if (period === 'today') periodDays = 1;
    else if (period === '7days') periodDays = 7;
    else if (period === '30days') periodDays = 30;

    const stats = await getAnalyticsStats(periodDays);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao buscar analytics' });
  }
});

app.get('/api/analytics/chart', authMiddleware, adminMiddleware, async (req: any, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = await getChatsByPeriod(days);
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao buscar dados do gráfico' });
  }
});

// ============================================
// FEEDBACK ROUTES
// ============================================

app.get('/api/feedbacks', authMiddleware, async (req: any, res) => {
  try {
    const feedbacks = await getAllFeedbacks();
    res.json({ feedbacks });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao buscar feedbacks' });
  }
});

app.post('/api/feedbacks', authMiddleware, async (req: any, res) => {
  try {
    const { agentId, agentName, rating, text, topic } = req.body;

    if (!agentId || !rating) {
      return res.status(400).json({ error: 'Agente e avaliação são obrigatórios' });
    }

    const feedback = await saveFeedback({
      userId: req.user.id,
      userName: req.user.name,
      agentId,
      agentName: agentName || 'Assistente Salesforce',
      rating,
      text,
      topic,
    });

    res.status(201).json({ feedback });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao salvar feedback' });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req: any, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

app.put('/api/admin/users/:id/role', authMiddleware, adminMiddleware, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'Perfil não especificado' });

    const user = await updateUserRole(userId, role);
    res.json({ user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Erro ao atualizar perfil' });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
    }
    await deleteUser(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Erro ao excluir usuário' });
  }
});

app.put('/api/admin/users/:id/password', authMiddleware, adminMiddleware, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await resetUserPassword(userId, passwordHash);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Erro ao redefinir senha' });
  }
});

// ============================================
// STATIC FILES (Production)
// ============================================

if (NODE_ENV === 'production') {
  const distPath = join(__dirname, '..', 'dist');
  app.use(express.static(distPath, {
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(join(distPath, 'index.html'));
  });
}

// ============================================
// SOCKET.IO
// ============================================

setupSocketHandlers(io);

// ============================================
// START SERVER
// ============================================

async function start() {
  try {
    await initDatabase();
    console.log('✅ Database connected and initialized.');
  } catch (err: any) {
    console.error('❌ Erro ao conectar ao banco de dados PostgreSQL:', err.message);
    console.error('💡 DICA: O PostgreSQL local precisa estar rodando.');
    console.error('   Rode em outro terminal: docker compose up -d (ou npm run dev:db)\n');
  }

  httpServer.listen(PORT, () => {
    console.log(`\n🚀 CRC Server running on port ${PORT}`);
    console.log(`   Environment: ${NODE_ENV}`);
    if (NODE_ENV === 'development') {
      console.log(`   API: http://localhost:${PORT}/api`);
      console.log(`   Frontend: http://localhost:5173\n`);
    }
  });
}

start();
