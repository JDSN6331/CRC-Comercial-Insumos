// ============================================
// CRC COMERCIAL INSUMOS — Main Application v3.0
// Single Page App Views & Admin Management
// ============================================

import './style.css';
import { io, Socket } from 'socket.io-client';

// ============================================
// TYPES
// ============================================

interface User {
  id: number;
  name: string;
  email: string;
  role: 'user' | 'analyst' | 'admin';
  avatar_color: string;
  created_at?: string;
  last_seen?: string;
  is_online?: boolean;
}

interface Agent {
  id: string;
  name: string;
  category: string;
  description: string;
  longDescription: string;
  status: 'online' | 'coming';
  avatarBg: string;
  tags: string[];
}

interface ChatMessage {
  id: number;
  chat_id: number;
  sender_type: 'user' | 'ai' | 'analyst' | 'system';
  sender_id: number | null;
  sender_name: string;
  text: string;
  created_at: string;
  is_read: boolean;
}

interface Chat {
  id: number;
  user_id: number;
  user_name?: string;
  agent_id: string;
  status: 'ai' | 'waiting' | 'human' | 'closed';
  assigned_analyst_id: number | null;
  analyst_name?: string;
  last_message?: string;
  unread_count?: number;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// STATE
// ============================================

let currentUser: User | null = null;
let socket: Socket | null = null;
let activeChat: Chat | null = null;
let activeChatMessages: ChatMessage[] = [];
let userChatsList: Chat[] = [];
let analystActiveChat: { chatId: number; messages: ChatMessage[] } | null = null;
let pendingChats: Chat[] = [];
let myAnalystChats: Chat[] = [];
let authMode: 'login' | 'register' = 'login';
let selectedPeriod: string = 'today';
let closeRatingChatId: number | null = null;
let closeRatingValue = 0;
let resetPasswordTargetUser: User | null = null;
let currentView = 'dashboard';

// ============================================
// AGENTS DATA
// ============================================

const agents: Agent[] = [
  {
    id: 'salesforce',
    name: 'Assistente Salesforce',
    category: 'Vendas & CRM',
    description: 'Tire dúvidas sobre o Salesforce, o sistema de vendas da Cooxupé. Pedidos, limites, descontos e muito mais.',
    longDescription: 'A IAra é uma agente de IA especializada no Salesforce da Cooxupé. Ajuda com navegação, criação de pedidos, limites de crédito, descontos, status de pedidos e tudo relacionado ao processo de vendas.',
    status: 'online',
    avatarBg: 'linear-gradient(135deg, #1e40af, #3b82f6)',
    tags: ['Salesforce', 'CRM', 'Vendas', 'Pedidos', 'Descontos'],
  },
  {
    id: 'demantra',
    name: 'Assistente Demantra',
    category: 'Planejamento & Demanda',
    description: 'Suporte sobre o sistema Demantra para planejamento de demanda, previsões e gestão de estoque.',
    longDescription: 'O Assistente Demantra ajudará com dúvidas sobre planejamento de demanda, forecasting e gestão de inventário.',
    status: 'coming',
    avatarBg: 'linear-gradient(135deg, #6d28d9, #8b5cf6)',
    tags: ['Demantra', 'Demanda', 'Previsão', 'Estoque'],
  },
  {
    id: 'campanhas',
    name: 'Assistente Campanhas',
    category: 'Marketing & Campanhas',
    description: 'Orientações sobre campanhas comerciais, promoções e estratégias de marketing.',
    longDescription: 'Especializado em campanhas comerciais e ações de marketing da Cooxupé.',
    status: 'coming',
    avatarBg: 'linear-gradient(135deg, #b45309, #f59e0b)',
    tags: ['Campanhas', 'Marketing', 'Promoções'],
  },
  {
    id: 'negocios',
    name: 'Assistente de Negócios',
    category: 'Estratégia & Negócios',
    description: 'Estratégias comerciais, oportunidades de negócios e análises de mercado.',
    longDescription: 'Suporte em decisões estratégicas e inteligência de mercado.',
    status: 'coming',
    avatarBg: 'linear-gradient(135deg, #047857, #10b981)',
    tags: ['Negócios', 'Estratégia', 'KPIs'],
  },
];

// ============================================
// API HELPERS
// ============================================

function getToken(): string | null {
  return localStorage.getItem('crc_token');
}

function setToken(token: string) {
  localStorage.setItem('crc_token', token);
}

function clearToken() {
  localStorage.removeItem('crc_token');
  localStorage.removeItem('crc_user');
}

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: any = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { ...options, headers });
  } catch (err: any) {
    throw new Error('Servidor backend indisponível. Verifique se o servidor está rodando.');
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`Servidor indisponível (${res.status}). Verifique se o PostgreSQL está rodando.`);
    }
    throw new Error('Resposta inválida do servidor.');
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ============================================
// THEME
// ============================================

function getStoredTheme(): string {
  return localStorage.getItem('crc_theme') || 'dark';
}

function setTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('crc_theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#060e08' : '#f2f7f3');
}

setTheme(getStoredTheme());

// ============================================
// TOAST
// ============================================

function showToast(message: string, type: 'success' | 'warning' | 'error' = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.classList.add('toast');
  const iconPath = type === 'success'
    ? '<polyline points="20 6 9 17 4 12"/>'
    : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  toast.innerHTML = `
    <svg class="toast-icon ${type}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
    <span class="toast-text">${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ============================================
// VIEW ROUTING (SPA PAGE SWITCHING)
// ============================================

function switchView(viewName: string) {
  if (!currentUser) return;

  // Access control checks
  if (viewName === 'admin' && currentUser.role !== 'admin') {
    showToast('Acesso restrito a Administradores', 'warning');
    return;
  }
  if (viewName === 'analytics' && currentUser.role !== 'admin') {
    showToast('Acesso restrito a Administradores', 'warning');
    return;
  }
  if (viewName === 'analyst' && currentUser.role !== 'analyst' && currentUser.role !== 'admin') {
    showToast('Acesso restrito a Analistas', 'warning');
    return;
  }

  currentView = viewName;

  // Update active view DOM
  document.querySelectorAll<HTMLElement>('.page-view').forEach(el => {
    el.classList.remove('active');
  });
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  // Update navbar links active state
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === viewName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Refresh page view data
  if (viewName === 'chat') {
    refreshUserChatsList();
  } else if (viewName === 'admin') {
    loadAdminUsers();
  } else if (viewName === 'analytics') {
    loadAnalytics();
  } else if (viewName === 'analyst') {
    refreshAnalystChats();
  }
}

// ============================================
// AUTH
// ============================================

function setupAuth() {
  const form = document.getElementById('auth-form') as HTMLFormElement;
  const toggleBtns = document.querySelectorAll<HTMLButtonElement>('.auth-toggle-btn');
  const nameGroup = document.getElementById('name-group') as HTMLElement;
  const submitText = document.getElementById('auth-submit-text') as HTMLElement;
  const passwordToggle = document.getElementById('password-toggle');
  const passwordInput = document.getElementById('auth-password') as HTMLInputElement;

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      authMode = btn.dataset.mode as 'login' | 'register';
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const slider = document.querySelector('.auth-toggle-slider') as HTMLElement;
      if (authMode === 'register') {
        slider.style.transform = 'translateX(100%)';
        nameGroup.style.display = 'block';
        nameGroup.style.maxHeight = '120px';
        submitText.textContent = 'Criar Conta';
      } else {
        slider.style.transform = 'translateX(0)';
        nameGroup.style.maxHeight = '0';
        setTimeout(() => { nameGroup.style.display = 'none'; }, 300);
        submitText.textContent = 'Entrar';
      }
      hideAuthError();
    });
  });

  passwordToggle?.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('auth-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('auth-password') as HTMLInputElement).value;
    const name = (document.getElementById('auth-name') as HTMLInputElement).value.trim();
    const spinner = document.getElementById('auth-spinner') as HTMLElement;
    const submitBtn = document.getElementById('auth-submit') as HTMLButtonElement;

    hideAuthError();
    submitBtn.disabled = true;
    spinner.style.display = 'block';
    document.getElementById('auth-submit-text')!.style.opacity = '0';

    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body: any = { email, password };
      if (authMode === 'register') {
        if (!name) throw new Error('Nome é obrigatório');
        body.name = name;
      }

      const data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      setToken(data.token);
      localStorage.setItem('crc_user', JSON.stringify(data.user));
      currentUser = data.user;
      onLoginSuccess();
    } catch (err: any) {
      showAuthError(err.message);
    } finally {
      submitBtn.disabled = false;
      spinner.style.display = 'none';
      document.getElementById('auth-submit-text')!.style.opacity = '1';
    }
  });
}

function showAuthError(msg: string) {
  const el = document.getElementById('auth-error')!;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideAuthError() {
  const el = document.getElementById('auth-error');
  if (el) el.style.display = 'none';
}

async function tryAutoLogin() {
  const token = getToken();
  const userStr = localStorage.getItem('crc_user');
  if (!token || !userStr) return false;

  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    return true;
  } catch {
    clearToken();
    return false;
  }
}

function onLoginSuccess() {
  document.getElementById('login-screen')!.style.display = 'none';
  document.getElementById('app')!.style.display = 'block';

  updateUserPermissionsUI();
  connectSocket();
  renderAgentCards();

  switchView('dashboard');
}

function logout() {
  socket?.disconnect();
  socket = null;
  currentUser = null;
  activeChat = null;
  clearToken();
  document.getElementById('app')!.style.display = 'none';
  document.getElementById('login-screen')!.style.display = 'flex';
  (document.getElementById('auth-form') as HTMLFormElement)?.reset();
}

function updateUserPermissionsUI() {
  if (!currentUser) return;

  const initials = currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avatarEl = document.getElementById('user-initials');
  if (avatarEl) {
    avatarEl.textContent = initials;
    (avatarEl.closest('.user-avatar-btn') as HTMLElement).style.background = currentUser.avatar_color;
  }
  const nameEl = document.getElementById('dropdown-user-name');
  if (nameEl) nameEl.textContent = currentUser.name;
  const roleEl = document.getElementById('dropdown-user-role');
  if (roleEl) roleEl.textContent = currentUser.role === 'admin' ? 'Administrador 👑' : currentUser.role === 'analyst' ? 'Analista 👤' : 'Usuário 🧑';

  // Role-based navigation visibility
  const isAnalystOrAdmin = currentUser.role === 'analyst' || currentUser.role === 'admin';
  const isAdmin = currentUser.role === 'admin';

  document.getElementById('nav-analyst-link')!.style.display = isAnalystOrAdmin ? 'block' : 'none';
  document.getElementById('mobile-analyst-btn')!.style.display = isAnalystOrAdmin ? 'flex' : 'none';
  document.getElementById('footer-analyst-link')!.style.display = isAnalystOrAdmin ? 'inline-block' : 'none';

  document.getElementById('nav-admin-link')!.style.display = isAdmin ? 'block' : 'none';
  document.getElementById('mobile-admin-btn')!.style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('footer-admin-link')!.style.display = isAdmin ? 'inline-block' : 'none';

  document.getElementById('nav-analytics-link')!.style.display = isAdmin ? 'block' : 'none';
  document.getElementById('footer-analytics-link')!.style.display = isAdmin ? 'inline-block' : 'none';
}

// ============================================
// SOCKET.IO
// ============================================

function connectSocket() {
  const token = getToken();
  if (!token) return;

  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('🔌 Socket connected');
    refreshUserChatsList();
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
  });

  // ── Chat events ──
  socket.on('chat:new_message', (msg: ChatMessage) => {
    if (activeChat && msg.chat_id === activeChat.id) {
      activeChatMessages.push(msg);
      renderChatMessage(msg, true);
      scrollChatToBottom();
    }
    if (analystActiveChat && msg.chat_id === analystActiveChat.chatId) {
      analystActiveChat.messages.push(msg);
      renderAnalystChatMessage(msg);
      scrollAnalystChatToBottom();
    }
    refreshUserChatsList();
  });

  socket.on('chat:typing', (data: { chatId: number; sender: string; senderName: string }) => {
    if (activeChat && data.chatId === activeChat.id && data.sender !== 'user') {
      showTypingIndicator(data.senderName);
    }
  });

  socket.on('chat:typing_stop', (data: { chatId: number }) => {
    if (activeChat && data.chatId === activeChat.id) {
      hideTypingIndicator();
    }
  });

  socket.on('chat:status_changed', (data: { chatId: number; status: string; analystName?: string }) => {
    if (activeChat && data.chatId === activeChat.id) {
      activeChat.status = data.status as Chat['status'];
      updateChatHeaderStatus();

      if (data.status === 'human') {
        showToast(`${data.analystName || 'Um analista'} entrou no chat!`, 'success');
      }
    }
    refreshUserChatsList();
  });

  socket.on('chat:transfer_suggested', (data: { chatId: number }) => {
    if (activeChat && data.chatId === activeChat.id) {
      showTransferButton();
    }
  });

  socket.on('chat:notification', (data: { chatId: number; preview: string; senderName: string }) => {
    showToast(`Nova mensagem de ${data.senderName}`, 'success');
    refreshUserChatsList();
  });

  socket.on('chat:trigger_rating', (data: { chatId: number; reason: string }) => {
    if (activeChat && data.chatId === activeChat.id) {
      closeRatingChatId = data.chatId;
      closeRatingValue = 0;
      openModal(document.getElementById('rating-modal')!);
      showToast(
        data.reason === 'gratitude'
          ? 'Atendimento concluído! Como foi sua experiência?'
          : 'Chat encerrado por 10 minutos de inatividade. Por favor, avalie seu atendimento.',
        'success'
      );
    }
  });

  // ── Analyst events ──
  socket.on('analyst:queue_update', (data: { pendingChats: Chat[]; pendingCount: number }) => {
    pendingChats = data.pendingChats;
    renderAnalystQueue();
  });

  socket.on('analyst:new_message', (data: { chatId: number; message: ChatMessage }) => {
    showToast(`Nova mensagem no chat #${data.chatId}`, 'success');
    refreshAnalystChats();
  });
}

// ============================================
// DEDICATED CHAT PAGE EXPERIENCE
// ============================================

function setupFullChat() {
  const sendBtn = document.getElementById('full-chat-send-btn')!;
  const input = document.getElementById('full-chat-input') as HTMLTextAreaElement;
  const transferBtn = document.getElementById('full-chat-transfer-btn')!;
  const closeBtn = document.getElementById('full-chat-close-btn')!;
  const newBtn = document.getElementById('chat-new-btn')!;

  sendBtn.addEventListener('click', () => sendMessage());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  transferBtn.addEventListener('click', requestTransfer);
  closeBtn.addEventListener('click', () => closeChatPrompt());
  newBtn.addEventListener('click', () => resetChatUI());

  document.getElementById('mobile-chat-sidebar-toggle')?.addEventListener('click', () => {
    document.querySelector('.chat-app-sidebar')?.classList.toggle('mobile-open');
  });

  renderChatAgentSelect();
}

function renderChatAgentSelect() {
  const container = document.getElementById('full-chat-agent-select');
  if (!container) return;

  container.innerHTML = agents
    .filter(a => a.status === 'online')
    .map(a => `
      <button class="chat-agent-option" data-agent="${a.id}">
        <div class="chat-agent-option-avatar" style="background: ${a.avatarBg}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
        </div>
        <div class="chat-agent-option-info">
          <span class="chat-agent-option-name">${a.name}</span>
          <span class="chat-agent-option-desc">${a.category}</span>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chat-agent-option-arrow"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `).join('');

  container.querySelectorAll<HTMLElement>('.chat-agent-option').forEach(btn => {
    btn.addEventListener('click', () => startNewChat(btn.dataset.agent || 'salesforce'));
  });
}

function refreshUserChatsList() {
  if (!socket) return;
  socket.emit('chat:get_my_chats', (res: any) => {
    if (res.success) {
      userChatsList = res.chats;
      renderUserChatsSidebar();
    }
  });
}

function renderUserChatsSidebar() {
  const container = document.getElementById('full-chat-my-list');
  if (!container) return;

  if (userChatsList.length === 0) {
    container.innerHTML = '<div class="empty-state-sm">Nenhuma conversa recente</div>';
    return;
  }

  container.innerHTML = userChatsList.map(chat => {
    const isActive = activeChat && activeChat.id === chat.id;
    const agent = agents.find(a => a.id === chat.agent_id) || agents[0];

    return `
      <div class="chat-sidebar-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
        <div class="chat-sidebar-avatar" style="background: ${agent.avatarBg}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
        </div>
        <div class="chat-sidebar-info">
          <span class="chat-sidebar-name">${agent.name}</span>
          <span class="chat-sidebar-preview">${chat.last_message ? chat.last_message.substring(0, 40) : 'Conversa iniciada...'}</span>
        </div>
        ${(chat.unread_count || 0) > 0 ? `<span class="analyst-chat-badge">${chat.unread_count}</span>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll<HTMLElement>('.chat-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.chatId!);
      joinExistingChat(id);
    });
  });
}

async function startNewChat(agentId: string) {
  if (!socket) return;
  const agent = agents.find(a => a.id === agentId) || agents[0];

  socket.emit('chat:create', { agentId }, (res: any) => {
    if (res.success) {
      activeChat = res.chat;
      activeChatMessages = res.greeting ? [res.greeting] : [];

      socket!.emit('chat:join', { chatId: res.chat.id }, () => {});

      updateChatHeaderForAgent(agent);
      renderAllChatMessages();
      showChatInput();
      hideChatWelcome();
      showChatActions();
      refreshUserChatsList();
      switchView('chat');
    } else {
      showToast('Erro ao iniciar chat: ' + res.error, 'error');
    }
  });
}

function joinExistingChat(chatId: number) {
  if (!socket) return;
  socket.emit('chat:join', { chatId }, (res: any) => {
    if (res.success) {
      activeChat = res.chat;
      activeChatMessages = res.messages || [];

      const agent = agents.find(a => a.id === res.chat.agent_id) || agents[0];
      updateChatHeaderForAgent(agent);
      renderAllChatMessages();
      showChatInput();
      hideChatWelcome();
      showChatActions();
      refreshUserChatsList();
      switchView('chat');
    }
  });
}

function sendMessage() {
  const input = document.getElementById('full-chat-input') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || !socket || !activeChat) return;

  input.value = '';
  input.style.height = 'auto';

  socket.emit('chat:send_message', { chatId: activeChat.id, text }, (res: any) => {
    if (!res.success) showToast('Erro ao enviar mensagem', 'error');
  });
}

function requestTransfer() {
  if (!socket || !activeChat) return;
  socket.emit('chat:request_transfer', { chatId: activeChat.id }, (res: any) => {
    if (res.success) {
      showToast('Transferência solicitada! Aguardando analista...', 'success');
      document.getElementById('full-chat-transfer-btn')!.style.display = 'none';
    }
  });
}

function closeChatPrompt() {
  if (!activeChat) return;
  closeRatingChatId = activeChat.id;
  closeRatingValue = 0;
  openModal(document.getElementById('rating-modal')!);
}

function setupRatingModal() {
  const stars = document.querySelectorAll<HTMLElement>('#close-rating-stars .modal-star');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      closeRatingValue = parseInt(star.dataset.value || '0');
      stars.forEach((s, i) => s.classList.toggle('active', i < closeRatingValue));
    });
    star.addEventListener('mouseenter', () => {
      const val = parseInt(star.dataset.value || '0');
      stars.forEach((s, i) => s.classList.toggle('active', i < val));
    });
    star.addEventListener('mouseleave', () => {
      stars.forEach((s, i) => s.classList.toggle('active', i < closeRatingValue));
    });
  });

  document.getElementById('close-rating-submit')?.addEventListener('click', () => {
    if (closeRatingValue === 0) {
      showToast('Selecione uma avaliação', 'warning');
      return;
    }
    const feedbackText = (document.getElementById('close-rating-text') as HTMLTextAreaElement).value;
    closeChat(closeRatingChatId!, closeRatingValue, feedbackText);
    closeModal(document.getElementById('rating-modal')!);
  });

  document.getElementById('close-rating-skip')?.addEventListener('click', () => {
    closeChat(closeRatingChatId!);
    closeModal(document.getElementById('rating-modal')!);
  });
}

function closeChat(chatId: number, rating?: number, feedbackText?: string) {
  if (!socket) return;
  socket.emit('chat:close', { chatId, rating, feedbackText }, (res: any) => {
    if (res.success) {
      showToast('Atendimento encerrado. Obrigado!', 'success');
      resetChatUI();
      refreshUserChatsList();
    }
  });
}

function resetChatUI() {
  activeChat = null;
  activeChatMessages = [];
  document.getElementById('full-chat-welcome')!.style.display = 'flex';
  document.getElementById('full-chat-input-bar')!.style.display = 'none';
  document.getElementById('full-chat-header')!.style.display = 'none';
  document.getElementById('full-chat-transfer-btn')!.style.display = 'none';
  document.getElementById('full-chat-close-btn')!.style.display = 'none';
  document.getElementById('chat-new-btn')!.style.display = 'none';

  const container = document.getElementById('full-chat-messages')!;
  const welcome = document.getElementById('full-chat-welcome')!;
  container.innerHTML = '';
  container.appendChild(welcome);
}

// ── Chat Rendering ──

function renderAllChatMessages() {
  const container = document.getElementById('full-chat-messages')!;
  const welcome = document.getElementById('full-chat-welcome')!;
  container.innerHTML = '';
  container.appendChild(welcome);

  activeChatMessages.forEach(msg => renderChatMessage(msg, false));
  scrollChatToBottom();
}

function renderChatMessage(msg: ChatMessage, animate: boolean) {
  const container = document.getElementById('full-chat-messages')!;
  const div = document.createElement('div');

  if (msg.sender_type === 'system') {
    div.className = 'chat-msg-system';
    div.innerHTML = `<span>${formatMessageText(msg.text)}</span>`;
  } else {
    const isUser = msg.sender_type === 'user';
    div.className = `chat-msg ${isUser ? 'chat-msg-user' : 'chat-msg-other'}`;
    if (animate) div.classList.add('chat-msg-animate');

    const avatarContent = msg.sender_type === 'ai'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/></svg>'
      : getInitials(msg.sender_name);

    const avatarClass = msg.sender_type === 'ai' ? 'ai-avatar' : msg.sender_type === 'analyst' ? 'analyst-avatar' : '';

    div.innerHTML = `
      ${!isUser ? `<div class="chat-msg-avatar ${avatarClass}">${avatarContent}</div>` : ''}
      <div class="chat-msg-bubble">
        ${!isUser ? `<div class="chat-msg-sender">${msg.sender_name}</div>` : ''}
        <div class="chat-msg-text">${formatMessageText(msg.text)}</div>
        <div class="chat-msg-time">${formatTime(msg.created_at)}</div>
      </div>
    `;
  }

  container.appendChild(div);
}

function showTypingIndicator(name: string) {
  hideTypingIndicator();
  const container = document.getElementById('full-chat-messages')!;
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-other chat-typing-indicator';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="chat-msg-avatar ai-avatar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/></svg>
    </div>
    <div class="chat-msg-bubble">
      <div class="chat-msg-sender">${name}</div>
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>`;
  container.appendChild(div);
  scrollChatToBottom();
}

function hideTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

function showTransferButton() {
  const btn = document.getElementById('full-chat-transfer-btn');
  if (btn && activeChat?.status === 'ai') {
    btn.style.display = 'inline-flex';
  }
}

function showChatInput() {
  document.getElementById('full-chat-input-bar')!.style.display = 'flex';
  (document.getElementById('full-chat-input') as HTMLTextAreaElement).focus();
}

function hideChatWelcome() {
  document.getElementById('full-chat-welcome')!.style.display = 'none';
}

function showChatActions() {
  document.getElementById('full-chat-close-btn')!.style.display = 'inline-flex';
  document.getElementById('chat-new-btn')!.style.display = 'inline-flex';
}

function updateChatHeaderForAgent(agent: Agent) {
  document.getElementById('full-chat-header')!.style.display = 'flex';
  document.getElementById('full-chat-name')!.textContent = agent.name;
  updateChatHeaderStatus();
  const avatar = document.getElementById('full-chat-avatar') as HTMLElement;
  avatar.style.background = agent.avatarBg;
}

function updateChatHeaderStatus() {
  const el = document.getElementById('full-chat-status')!;
  if (!activeChat) return;
  const statusMap: Record<string, string> = {
    ai: '🤖 Atendimento por IA',
    waiting: '⏳ Aguardando analista...',
    human: `👤 Atendimento humano`,
    closed: '✅ Encerrado',
  };
  el.textContent = statusMap[activeChat.status] || activeChat.status;
}

function scrollChatToBottom() {
  const container = document.getElementById('full-chat-messages')!;
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

// ============================================
// ANALYST PANEL
// ============================================

function refreshAnalystChats() {
  if (!socket) return;
  socket.emit('analyst:get_queue', (res: any) => {
    if (res.success) {
      pendingChats = res.pending;
      myAnalystChats = res.myChats;
      renderAnalystQueue();
      renderAnalystMyChats();
    }
  });
}

function renderAnalystQueue() {
  const list = document.getElementById('analyst-pending-list')!;
  document.getElementById('analyst-pending-count')!.textContent = String(pendingChats.length);

  const mobileBadge = document.getElementById('mobile-analyst-badge');
  if (mobileBadge) {
    mobileBadge.textContent = String(pendingChats.length);
    mobileBadge.style.display = pendingChats.length > 0 ? 'flex' : 'none';
  }

  if (pendingChats.length === 0) {
    list.innerHTML = '<div class="empty-state-sm">Nenhum chat na fila</div>';
    return;
  }

  list.innerHTML = pendingChats.map(chat => `
    <div class="analyst-chat-item" data-chat-id="${chat.id}">
      <div class="analyst-chat-item-info">
        <span class="analyst-chat-item-name">${chat.user_name || 'Usuário'}</span>
        <span class="analyst-chat-item-preview">${chat.last_message?.substring(0, 60) || 'Sem mensagens'}${(chat.last_message?.length || 0) > 60 ? '...' : ''}</span>
        <span class="analyst-chat-item-time">${formatTime(chat.created_at)}</span>
      </div>
      <button class="btn btn-primary btn-xs analyst-assign-btn" data-chat-id="${chat.id}">Assumir</button>
    </div>
  `).join('');

  list.querySelectorAll<HTMLElement>('.analyst-assign-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      assignChat(parseInt(btn.dataset.chatId!));
    });
  });
}

function renderAnalystMyChats() {
  const list = document.getElementById('analyst-my-list')!;
  document.getElementById('analyst-my-count')!.textContent = String(myAnalystChats.length);

  if (myAnalystChats.length === 0) {
    list.innerHTML = '<div class="empty-state-sm">Nenhum chat ativo</div>';
    return;
  }

  list.innerHTML = myAnalystChats.map(chat => `
    <div class="analyst-chat-item analyst-chat-item-active" data-chat-id="${chat.id}">
      <div class="analyst-chat-item-info">
        <span class="analyst-chat-item-name">${chat.user_name || 'Usuário'}</span>
        <span class="analyst-chat-item-preview">${chat.last_message?.substring(0, 60) || '...'}${(chat.last_message?.length || 0) > 60 ? '...' : ''}</span>
      </div>
      ${(chat.unread_count || 0) > 0 ? `<span class="analyst-chat-badge">${chat.unread_count}</span>` : ''}
    </div>
  `).join('');

  list.querySelectorAll<HTMLElement>('.analyst-chat-item-active').forEach(item => {
    item.addEventListener('click', () => openAnalystChat(parseInt(item.dataset.chatId!)));
  });
}

function assignChat(chatId: number) {
  if (!socket) return;
  socket.emit('analyst:assign', { chatId }, (res: any) => {
    if (res.success) {
      showToast('Chat assumido!', 'success');
      openAnalystChat(chatId);
      refreshAnalystChats();
    } else {
      showToast('Erro: ' + res.error, 'error');
    }
  });
}

function openAnalystChat(chatId: number) {
  if (!socket) return;
  socket.emit('chat:join', { chatId }, (res: any) => {
    if (res.success) {
      analystActiveChat = { chatId, messages: res.messages || [] };
      const modal = document.getElementById('analyst-chat-modal')!;
      document.getElementById('analyst-modal-name')!.textContent = res.chat.user_name || 'Usuário';
      document.getElementById('analyst-modal-status')!.textContent = `Chat #${chatId}`;

      renderAllAnalystChatMessages();
      openModal(modal);
    }
  });
}

function renderAllAnalystChatMessages() {
  const container = document.getElementById('analyst-chat-messages')!;
  container.innerHTML = '';
  analystActiveChat?.messages.forEach(msg => renderAnalystChatMessage(msg));
  scrollAnalystChatToBottom();
}

function renderAnalystChatMessage(msg: ChatMessage) {
  const container = document.getElementById('analyst-chat-messages')!;
  const div = document.createElement('div');

  if (msg.sender_type === 'system') {
    div.className = 'chat-msg-system';
    div.innerHTML = `<span>${formatMessageText(msg.text)}</span>`;
  } else {
    const isAnalyst = msg.sender_type === 'analyst';
    div.className = `chat-msg ${isAnalyst ? 'chat-msg-user' : 'chat-msg-other'}`;
    const avatarContent = msg.sender_type === 'ai'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/></svg>'
      : getInitials(msg.sender_name);
    div.innerHTML = `
      ${!isAnalyst ? `<div class="chat-msg-avatar ${msg.sender_type === 'ai' ? 'ai-avatar' : ''}">${avatarContent}</div>` : ''}
      <div class="chat-msg-bubble">
        ${!isAnalyst ? `<div class="chat-msg-sender">${msg.sender_name}</div>` : ''}
        <div class="chat-msg-text">${formatMessageText(msg.text)}</div>
        <div class="chat-msg-time">${formatTime(msg.created_at)}</div>
      </div>`;
  }
  container.appendChild(div);
}

function scrollAnalystChatToBottom() {
  const container = document.getElementById('analyst-chat-messages')!;
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function setupAnalystChatModal() {
  const sendBtn = document.getElementById('analyst-send-btn')!;
  const input = document.getElementById('analyst-chat-input') as HTMLTextAreaElement;
  const closeBtn = document.getElementById('analyst-modal-close')!;
  const closeChatBtn = document.getElementById('analyst-close-chat-btn')!;

  sendBtn.addEventListener('click', sendAnalystMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAnalystMessage();
    }
  });

  closeBtn.addEventListener('click', () => {
    closeModal(document.getElementById('analyst-chat-modal')!);
    analystActiveChat = null;
  });

  closeChatBtn.addEventListener('click', () => {
    if (!analystActiveChat || !socket) return;
    socket.emit('chat:close', { chatId: analystActiveChat.chatId }, (res: any) => {
      if (res.success) {
        showToast('Chat encerrado', 'success');
        closeModal(document.getElementById('analyst-chat-modal')!);
        analystActiveChat = null;
        refreshAnalystChats();
      }
    });
  });
}

function sendAnalystMessage() {
  const input = document.getElementById('analyst-chat-input') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || !socket || !analystActiveChat) return;

  input.value = '';

  socket.emit('analyst:send_message', { chatId: analystActiveChat.chatId, text }, (res: any) => {
    if (!res.success) showToast('Erro ao enviar', 'error');
  });
}

// ============================================
// ADMIN CONTROL PANEL & USER MANAGEMENT
// ============================================

async function loadAdminUsers() {
  try {
    const data = await api('/api/admin/users');
    const users: User[] = data.users || [];
    renderAdminUsersTable(users);
  } catch (err: any) {
    showToast('Erro ao carregar usuários: ' + err.message, 'error');
  }
}

function renderAdminUsersTable(users: User[]) {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;

  const total = users.length;
  const analysts = users.filter(u => u.role === 'analyst').length;
  const admins = users.filter(u => u.role === 'admin').length;

  document.getElementById('admin-stat-users')!.textContent = String(total);
  document.getElementById('admin-stat-analysts')!.textContent = String(analysts);
  document.getElementById('admin-stat-admins')!.textContent = String(admins);

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state-sm">Nenhum usuário cadastrado</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => {
    const isSelf = currentUser && currentUser.id === user.id;

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar-sm" style="background: ${user.avatar_color}">
              ${getInitials(user.name)}
            </div>
            <span style="font-weight: 600;">${user.name} ${isSelf ? '<small style="color: var(--gold-400);">(Você)</small>' : ''}</span>
          </div>
        </td>
        <td style="color: var(--text-secondary);">${user.email}</td>
        <td>
          <span class="user-role-badge role-${user.role}">
            ${user.role === 'admin' ? 'Administrador' : user.role === 'analyst' ? 'Analista' : 'Usuário'}
          </span>
        </td>
        <td>
          <select class="role-select" data-user-id="${user.id}">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>Usuário</option>
            <option value="analyst" ${user.role === 'analyst' ? 'selected' : ''}>Analista</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </td>
        <td>
          <div class="admin-actions-cell">
            <button class="btn btn-outline btn-xs admin-pwd-btn" data-user-id="${user.id}" data-user-name="${user.name}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>Redefinir Senha</span>
            </button>
            ${!isSelf ? `
              <button class="btn btn-danger btn-xs admin-del-btn" data-user-id="${user.id}" data-user-name="${user.name}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Excluir</span>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Role select listener
  tbody.querySelectorAll<HTMLSelectElement>('.role-select').forEach(select => {
    select.addEventListener('change', async () => {
      const userId = parseInt(select.dataset.userId!);
      const newRole = select.value;
      try {
        await api(`/api/admin/users/${userId}/role`, {
          method: 'PUT',
          body: JSON.stringify({ role: newRole }),
        });
        showToast('Perfil atualizado com sucesso!', 'success');
        loadAdminUsers();
      } catch (err: any) {
        showToast('Erro ao atualizar: ' + err.message, 'error');
      }
    });
  });

  // Reset password button listener
  tbody.querySelectorAll<HTMLElement>('.admin-pwd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = parseInt(btn.dataset.userId!);
      const name = btn.dataset.userName!;
      resetPasswordTargetUser = { id: userId, name } as any;

      document.getElementById('reset-password-user-name')!.textContent = name;
      (document.getElementById('reset-new-password') as HTMLInputElement).value = '';
      openModal(document.getElementById('reset-password-modal')!);
    });
  });

  // Delete user button listener
  tbody.querySelectorAll<HTMLElement>('.admin-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = parseInt(btn.dataset.userId!);
      const name = btn.dataset.userName!;
      if (confirm(`Tem certeza que deseja excluir permanentemente o usuário "${name}"?`)) {
        try {
          await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
          showToast(`Usuário "${name}" excluído com sucesso.`, 'success');
          loadAdminUsers();
        } catch (err: any) {
          showToast('Erro ao excluir: ' + err.message, 'error');
        }
      }
    });
  });
}

function setupResetPasswordModal() {
  const submitBtn = document.getElementById('reset-password-submit')!;
  const cancelBtn = document.getElementById('reset-password-cancel')!;
  const modal = document.getElementById('reset-password-modal')!;

  cancelBtn.addEventListener('click', () => {
    closeModal(modal);
    resetPasswordTargetUser = null;
  });

  submitBtn.addEventListener('click', async () => {
    if (!resetPasswordTargetUser) return;
    const input = document.getElementById('reset-new-password') as HTMLInputElement;
    const newPassword = input.value;

    if (!newPassword || newPassword.length < 6) {
      showToast('A senha deve ter no mínimo 6 caracteres', 'warning');
      return;
    }

    try {
      await api(`/api/admin/users/${resetPasswordTargetUser.id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ newPassword }),
      });
      showToast(`Senha de ${resetPasswordTargetUser.name} redefinida com sucesso!`, 'success');
      closeModal(modal);
      resetPasswordTargetUser = null;
    } catch (err: any) {
      showToast('Erro ao redefinir senha: ' + err.message, 'error');
    }
  });
}

// ============================================
// AGENTS GRID
// ============================================

function renderAgentCards(filter: string = 'all') {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  const filtered = filter === 'all' ? agents
    : filter === 'active' ? agents.filter(a => a.status === 'online')
    : agents.filter(a => a.status === 'coming');

  grid.innerHTML = filtered.map(agent => `
    <div class="agent-card glass-panel ${agent.status === 'coming' ? 'coming-soon' : ''} reveal"
         data-agent-id="${agent.id}"
         ${agent.status === 'online' ? 'role="button" tabindex="0"' : ''}>
      <div class="agent-card-top">
        <div class="agent-avatar" style="background: ${agent.avatarBg}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
        </div>
        <div class="agent-status ${agent.status}">
          ${agent.status === 'online' ? '<span class="status-dot"></span> Online' : '🕐 Em Breve'}
        </div>
      </div>
      <h3 class="agent-name">${agent.name}</h3>
      <p class="agent-category">${agent.category}</p>
      <p class="agent-description">${agent.description}</p>
      <div class="agent-card-actions">
        ${agent.status === 'online' ? `
          <button class="btn btn-primary btn-sm agent-chat-btn" data-agent="${agent.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flaticon-inline-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Iniciar Conversa</span>
          </button>
        ` : `
          <button class="btn btn-outline btn-sm btn-full" disabled><span>Em Breve</span></button>
        `}
      </div>
    </div>
  `).join('');

  setTimeout(() => {
    document.querySelectorAll('.agent-card.reveal').forEach(el => el.classList.add('visible'));
  }, 100);

  document.querySelectorAll<HTMLElement>('.agent-chat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      startNewChat(btn.dataset.agent || 'salesforce');
    });
  });

  document.querySelectorAll<HTMLElement>('.agent-card:not(.coming-soon)').forEach(card => {
    card.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      card.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    });
  });
}

// ============================================
// ANALYTICS (Admin Only)
// ============================================

async function loadAnalytics() {
  try {
    const stats = await api(`/api/analytics/stats?period=${selectedPeriod}`);
    renderAnalyticsFromData(stats);
  } catch (err: any) {
    renderEmptyAnalytics();
  }

  try {
    const fbData = await api('/api/feedbacks');
    renderFeedbacksTable(fbData.feedbacks || []);
  } catch (err: any) {
    renderFeedbacksTable([]);
  }
}

function renderFeedbacksTable(feedbacks: any[]) {
  const tbody = document.getElementById('analytics-feedbacks-table-body');
  if (!tbody) return;
  if (feedbacks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state-sm">Nenhum feedback registrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = feedbacks.map(f => `
    <tr>
      <td><strong>${f.user_name || f.userName || 'Usuário'}</strong></td>
      <td><span style="color: var(--gold-400); font-weight: 700;">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)} (${f.rating})</span></td>
      <td>${f.text || f.feedback_text || '<em style="color: var(--text-muted);">Sem comentário</em>'}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${formatTime(f.created_at)}</td>
    </tr>
  `).join('');
}

function renderAnalyticsFromData(stats: any) {
  const convEl = document.getElementById('stat-conversations');
  if (convEl) convEl.textContent = String(stats.chats?.total || 0);

  const ratingEl = document.getElementById('stat-rating');
  if (ratingEl) ratingEl.textContent = stats.rating?.avg_rating ? stats.rating.avg_rating.toFixed(1) : '--';

  const satEl = document.getElementById('stat-satisfaction');
  if (satEl) {
    const fb = stats.feedbacks;
    if (fb && fb.total > 0) {
      satEl.textContent = Math.round((fb.positive / fb.total) * 100) + '%';
    } else {
      satEl.textContent = '--';
    }
  }

  const chartEl = document.getElementById('chart-empty');
  if (chartEl) {
    const total = stats.chats?.total || 0;
    if (total > 0) {
      const aiActive = stats.chats.ai_active || 0;
      const waiting = stats.chats.waiting || 0;
      const humanActive = stats.chats.human_active || 0;
      const closed = stats.chats.closed || 0;

      chartEl.innerHTML = `
        <div class="bar-chart-container">
          <div class="bar-chart-item"><span class="bar-chart-label">Total</span><div class="bar-chart-track"><div class="bar-chart-fill" style="width:100%"></div></div><span class="bar-chart-value">${total}</span></div>
          <div class="bar-chart-item"><span class="bar-chart-label">IA</span><div class="bar-chart-track"><div class="bar-chart-fill fill-blue" style="width:${total > 0 ? (aiActive / total) * 100 : 0}%"></div></div><span class="bar-chart-value">${aiActive}</span></div>
          <div class="bar-chart-item"><span class="bar-chart-label">Na Fila</span><div class="bar-chart-track"><div class="bar-chart-fill fill-amber" style="width:${total > 0 ? (waiting / total) * 100 : 0}%"></div></div><span class="bar-chart-value">${waiting}</span></div>
          <div class="bar-chart-item"><span class="bar-chart-label">Humano</span><div class="bar-chart-track"><div class="bar-chart-fill fill-purple" style="width:${total > 0 ? (humanActive / total) * 100 : 0}%"></div></div><span class="bar-chart-value">${humanActive}</span></div>
          <div class="bar-chart-item"><span class="bar-chart-label">Encerrados</span><div class="bar-chart-track"><div class="bar-chart-fill fill-green" style="width:${total > 0 ? (closed / total) * 100 : 0}%"></div></div><span class="bar-chart-value">${closed}</span></div>
        </div>`;
    } else {
      chartEl.innerHTML = renderEmptyState('Nenhuma conversa neste período', 'Conversas aparecerão aqui conforme os chats forem iniciados.');
    }
  }

  const resEl = document.getElementById('resolution-empty');
  if (resEl) {
    const res = stats.resolution;
    const aiResolved = res?.resolved_by_ai || 0;
    const humanResolved = res?.resolved_by_human || 0;
    const total = aiResolved + humanResolved;
    if (total > 0) {
      const aiPct = Math.round((aiResolved / total) * 100);
      resEl.innerHTML = `
        <div class="resolution-card-content">
          <div class="resolution-percentage">${aiPct}%</div>
          <div class="resolution-subtitle">Resolvidos pela IA</div>
          <div class="resolution-breakdown">
            <div class="resolution-item"><span class="resolution-dot dot-resolved"></span><span>IA: <strong>${aiResolved}</strong></span></div>
            <div class="resolution-item"><span class="resolution-dot dot-unresolved"></span><span>Humano: <strong>${humanResolved}</strong></span></div>
          </div>
        </div>`;
    } else {
      resEl.innerHTML = renderEmptyState('Nenhum dado de resolução', 'Os dados aparecerão quando chats forem encerrados.');
    }
  }

  const ratingsEl = document.getElementById('ratings-empty');
  if (ratingsEl) {
    const avgRating = stats.rating?.avg_rating;
    const ratedCount = stats.rating?.rated_count || 0;
    if (ratedCount > 0) {
      ratingsEl.innerHTML = `
        <div class="resolution-card-content">
          <div class="resolution-percentage">${avgRating?.toFixed(1)} ★</div>
          <div class="resolution-subtitle">Média de ${ratedCount} avaliações</div>
        </div>`;
    } else {
      ratingsEl.innerHTML = renderEmptyState('Sem avaliações', 'As notas serão consolidadas aqui.');
    }
  }

  const rtEl = document.getElementById('response-time-empty');
  if (rtEl) {
    rtEl.innerHTML = `
      <div class="resolution-card-content">
        <div class="resolution-percentage" style="font-size: 1.8rem;">< 5s</div>
        <div class="resolution-subtitle">Tempo médio (IA)</div>
        <p style="color: var(--text-muted); font-size: 0.8rem; margin-top: 0.5rem;">O agente de IA responde em segundos. Analistas humanos dependem da disponibilidade.</p>
      </div>`;
  }
}

function renderEmptyAnalytics() {
  ['chart-empty', 'resolution-empty', 'ratings-empty', 'response-time-empty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = renderEmptyState('Sem dados', 'Inicie conversas para visualizar métricas.');
  });
}

function renderEmptyState(title: string, text: string): string {
  return `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><p class="empty-title">${title}</p><p class="empty-text">${text}</p></div>`;
}

// ============================================
// UTILS
// ============================================

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatMessageText(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// ============================================
// MODALS
// ============================================

function openModal(modal: HTMLElement) {
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal: HTMLElement) {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ============================================
// NAVIGATION
// ============================================

function setupNavigation() {
  const navbar = document.getElementById('navbar')!;
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');

  // SPA View navigation listener for navbar buttons and footer links
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('active');
      navLinks.classList.toggle('open');
      document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
    });
    navLinks.querySelectorAll('.nav-link').forEach(link =>
      link.addEventListener('click', () => {
        navToggle.classList.remove('active');
        navLinks.classList.remove('open');
        document.body.style.overflow = '';
      })
    );
  }

  document.querySelectorAll<HTMLElement>('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPeriod = btn.dataset.period || 'today';
      loadAnalytics();
    });
  });

  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');
  avatarBtn?.addEventListener('click', () => {
    dropdown?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!avatarBtn?.contains(e.target as Node) && !dropdown?.contains(e.target as Node)) {
      dropdown?.classList.remove('open');
    }
  });

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  document.getElementById('logout-btn')?.addEventListener('click', logout);

  document.querySelectorAll<HTMLElement>('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAgentCards(btn.dataset.filter!);
    });
  });

  document.querySelectorAll<HTMLElement>('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll<HTMLElement>('.modal-overlay.open').forEach(m => closeModal(m));
    }
  });
}

// ============================================
// SCROLL REVEAL
// ============================================

function setupScrollReveal() {
  const els = document.querySelectorAll<HTMLElement>('.analytics-card, .stat-card');
  els.forEach(el => el.classList.add('reveal'));
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        (entry.target as HTMLElement).classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => obs.observe(el));
}

// ============================================
// INIT
// ============================================

async function init() {
  setupAuth();
  setupNavigation();
  setupFullChat();
  setupRatingModal();
  setupAnalystChatModal();
  setupResetPasswordModal();
  setupScrollReveal();

  const loggedIn = await tryAutoLogin();
  if (loggedIn) {
    onLoginSuccess();
  } else {
    document.getElementById('login-screen')!.style.display = 'flex';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
