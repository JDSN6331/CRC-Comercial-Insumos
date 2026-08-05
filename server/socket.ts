// ============================================
// SOCKET.IO — Real-Time Chat Handlers v3.0
// Auto-Close 10min Inactivity + Gratitude Detection
// ============================================

import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import {
  createChat, getChatById, addMessage, getMessages,
  updateChatStatus, getActiveChatsForUser, getPendingChats,
  getAnalystActiveChats, markMessagesRead, setUserOnline,
  rateChatAndClose,
} from './db.js';
import { getAIResponse } from './groq.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  userName?: string;
  userRole?: string;
}

// Inactivity timer map (10 minutes per active chat)
const inactivityTimers = new Map<number, NodeJS.Timeout>();
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Gratitude keyword regex
const thankKeywords = /\b(obrigad[oa]|valeu|vlw|agradeço|agradeco|obrigadão|obrigadao|resolvido|ótimo atendimento|otimo atendimento|ajudou muito|perfeito, obrigado|muito obrigado|muito obrigada)\b/i;

function resetInactivityTimer(chatId: number, io: Server) {
  if (inactivityTimers.has(chatId)) {
    clearTimeout(inactivityTimers.get(chatId)!);
  }

  const timer = setTimeout(async () => {
    try {
      const chat = await getChatById(chatId);
      if (chat && chat.status !== 'closed') {
        await updateChatStatus(chatId, 'closed');
        const systemMsg = await addMessage(
          chatId, 'system', null, 'Sistema',
          '⏳ Atendimento encerrado por 10 minutos de inatividade. Por favor, deixe sua avaliação abaixo.'
        );
        io.to(`chat:${chatId}`).emit('chat:new_message', systemMsg);
        io.to(`chat:${chatId}`).emit('chat:status_changed', { chatId, status: 'closed' });
        io.to(`chat:${chatId}`).emit('chat:trigger_rating', { chatId, reason: 'inactivity' });
      }
    } catch (err: any) {
      console.error('Error auto-closing inactive chat:', err.message);
    } finally {
      inactivityTimers.delete(chatId);
    }
  }, INACTIVITY_TIMEOUT_MS);

  inactivityTimers.set(chatId, timer);
}

function clearInactivityTimer(chatId: number) {
  if (inactivityTimers.has(chatId)) {
    clearTimeout(inactivityTimers.get(chatId)!);
    inactivityTimers.delete(chatId);
  }
}

export function setupSocketHandlers(io: Server): void {
  // ── Authentication Middleware ──
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      socket.userId = decoded.id;
      socket.userName = decoded.name;
      socket.userRole = decoded.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    const userName = socket.userName!;
    const userRole = socket.userRole!;

    console.log(`🔌 Connected: ${userName} (${userRole}) [${socket.id}]`);

    socket.join(`user:${userId}`);

    if (userRole === 'analyst' || userRole === 'admin') {
      socket.join('analysts');
    }

    await setUserOnline(userId, true);

    // ── CREATE CHAT ──
    socket.on('chat:create', async (data: { agentId?: string }, callback) => {
      try {
        const chat = await createChat(userId, data.agentId || 'salesforce');

        const greeting = await addMessage(
          chat.id, 'ai', null, 'IAra',
          'Olá! 😊 Sou a **IAra**, assistente virtual de suporte Salesforce da Cooxupé. Como posso te ajudar hoje?'
        );

        socket.join(`chat:${chat.id}`);
        resetInactivityTimer(chat.id, io);

        callback?.({ success: true, chat, greeting });
      } catch (err: any) {
        console.error('Error creating chat:', err.message);
        callback?.({ success: false, error: err.message });
      }
    });

    // ── JOIN EXISTING CHAT ──
    socket.on('chat:join', async (data: { chatId: number }, callback) => {
      try {
        const chat = await getChatById(data.chatId);
        if (!chat) return callback?.({ success: false, error: 'Chat not found' });

        const canJoin =
          chat.user_id === userId ||
          chat.assigned_analyst_id === userId ||
          userRole === 'admin';

        if (!canJoin) return callback?.({ success: false, error: 'Access denied' });

        socket.join(`chat:${data.chatId}`);
        const messages = await getMessages(data.chatId);
        await markMessagesRead(data.chatId, userRole === 'user' ? 'user' : 'analyst');
        callback?.({ success: true, chat, messages });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── SEND MESSAGE (USER) ──
    socket.on('chat:send_message', async (data: { chatId: number; text: string }, callback) => {
      try {
        const chat = await getChatById(data.chatId);
        if (!chat) return callback?.({ success: false, error: 'Chat not found' });

        // Save user message
        const userMsg = await addMessage(
          data.chatId, 'user', userId, userName, data.text
        );

        io.to(`chat:${data.chatId}`).emit('chat:new_message', userMsg);
        resetInactivityTimer(data.chatId, io);

        const isGratitude = thankKeywords.test(data.text);

        // If chat is in AI mode
        if (chat.status === 'ai') {
          io.to(`chat:${data.chatId}`).emit('chat:typing', {
            chatId: data.chatId,
            sender: 'ai',
            senderName: 'IAra',
          });

          const history = await getMessages(data.chatId);
          const aiResponse = await getAIResponse(history);

          const aiMsg = await addMessage(
            data.chatId, 'ai', null, 'IAra', aiResponse.text
          );

          io.to(`chat:${data.chatId}`).emit('chat:typing_stop', { chatId: data.chatId });
          io.to(`chat:${data.chatId}`).emit('chat:new_message', aiMsg);

          if (aiResponse.suggestsTransfer) {
            io.to(`chat:${data.chatId}`).emit('chat:transfer_suggested', { chatId: data.chatId });
          }
        }

        if (chat.status === 'human' && chat.assigned_analyst_id) {
          io.to(`user:${chat.assigned_analyst_id}`).emit('analyst:new_message', {
            chatId: data.chatId,
            message: userMsg,
          });
        }

        // Gratitude trigger: if user thanks, prompt evaluation
        if (isGratitude) {
          setTimeout(() => {
            io.to(`chat:${data.chatId}`).emit('chat:trigger_rating', {
              chatId: data.chatId,
              reason: 'gratitude',
            });
          }, 1500);
        }

        callback?.({ success: true });
      } catch (err: any) {
        console.error('Error sending message:', err.message);
        callback?.({ success: false, error: err.message });
      }
    });

    // ── REQUEST TRANSFER ──
    socket.on('chat:request_transfer', async (data: { chatId: number }, callback) => {
      try {
        await updateChatStatus(data.chatId, 'waiting');

        const systemMsg = await addMessage(
          data.chatId, 'system', null, 'Sistema',
          '🔄 Transferência solicitada. Aguardando um analista disponível...'
        );

        io.to(`chat:${data.chatId}`).emit('chat:new_message', systemMsg);
        io.to(`chat:${data.chatId}`).emit('chat:status_changed', {
          chatId: data.chatId,
          status: 'waiting',
        });

        resetInactivityTimer(data.chatId, io);

        const pendingChats = await getPendingChats();
        io.to('analysts').emit('analyst:queue_update', {
          pendingChats,
          pendingCount: pendingChats.length,
        });

        callback?.({ success: true });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── ANALYST: ASSIGN CHAT ──
    socket.on('analyst:assign', async (data: { chatId: number }, callback) => {
      try {
        if (userRole !== 'analyst' && userRole !== 'admin') {
          return callback?.({ success: false, error: 'Not authorized' });
        }

        await updateChatStatus(data.chatId, 'human', userId);
        socket.join(`chat:${data.chatId}`);

        const systemMsg = await addMessage(
          data.chatId, 'system', null, 'Sistema',
          `✅ **${userName}** assumiu o atendimento. Como posso te ajudar?`
        );

        io.to(`chat:${data.chatId}`).emit('chat:new_message', systemMsg);
        io.to(`chat:${data.chatId}`).emit('chat:status_changed', {
          chatId: data.chatId,
          status: 'human',
          analystName: userName,
        });

        resetInactivityTimer(data.chatId, io);

        const pendingChats = await getPendingChats();
        io.to('analysts').emit('analyst:queue_update', {
          pendingChats,
          pendingCount: pendingChats.length,
        });

        const messages = await getMessages(data.chatId);
        callback?.({ success: true, messages });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── ANALYST: SEND MESSAGE ──
    socket.on('analyst:send_message', async (data: { chatId: number; text: string }, callback) => {
      try {
        if (userRole !== 'analyst' && userRole !== 'admin') {
          return callback?.({ success: false, error: 'Not authorized' });
        }

        const msg = await addMessage(
          data.chatId, 'analyst', userId, userName, data.text
        );

        io.to(`chat:${data.chatId}`).emit('chat:new_message', msg);
        resetInactivityTimer(data.chatId, io);

        const chat = await getChatById(data.chatId);
        if (chat) {
          io.to(`user:${chat.user_id}`).emit('chat:notification', {
            chatId: data.chatId,
            preview: data.text.substring(0, 100),
            senderName: userName,
          });
        }

        callback?.({ success: true });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── CLOSE CHAT & RATE ──
    socket.on('chat:close', async (data: { chatId: number; rating?: number; feedbackText?: string }, callback) => {
      try {
        clearInactivityTimer(data.chatId);

        if (data.rating) {
          await rateChatAndClose(data.chatId, data.rating, data.feedbackText);
        } else {
          await updateChatStatus(data.chatId, 'closed');
        }

        const systemMsg = await addMessage(
          data.chatId, 'system', null, 'Sistema',
          '📋 Atendimento encerrado. Obrigado pelo contato!'
        );

        io.to(`chat:${data.chatId}`).emit('chat:new_message', systemMsg);
        io.to(`chat:${data.chatId}`).emit('chat:status_changed', {
          chatId: data.chatId,
          status: 'closed',
        });

        callback?.({ success: true });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── TYPING INDICATORS ──
    socket.on('chat:typing', (data: { chatId: number }) => {
      socket.to(`chat:${data.chatId}`).emit('chat:typing', {
        chatId: data.chatId,
        sender: userRole === 'user' ? 'user' : 'analyst',
        senderName: userName,
      });
    });

    socket.on('chat:typing_stop', (data: { chatId: number }) => {
      socket.to(`chat:${data.chatId}`).emit('chat:typing_stop', {
        chatId: data.chatId,
      });
    });

    // ── GET USER'S CHATS ──
    socket.on('chat:get_my_chats', async (callback) => {
      try {
        const chats = await getActiveChatsForUser(userId);
        callback?.({ success: true, chats });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── ANALYST: GET QUEUE ──
    socket.on('analyst:get_queue', async (callback) => {
      try {
        if (userRole !== 'analyst' && userRole !== 'admin') {
          return callback?.({ success: false, error: 'Not authorized' });
        }
        const pending = await getPendingChats();
        const myChats = await getAnalystActiveChats(userId);
        callback?.({ success: true, pending, myChats });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── DISCONNECT ──
    socket.on('disconnect', async () => {
      console.log(`🔌 Disconnected: ${userName} [${socket.id}]`);
      await setUserOnline(userId, false);
    });
  });
}
