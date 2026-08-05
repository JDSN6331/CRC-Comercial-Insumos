// ============================================
// GROQ AI SERVICE — Secure Server-Side
// ============================================

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ============================================
// SYSTEM PROMPT LOADING
// ============================================

let BASE_SYSTEM_PROMPT = '';

try {
  BASE_SYSTEM_PROMPT = readFileSync(
    join(__dirname, '..', 'SYSTEM PROMPT - Assistente do Salesforce.txt'),
    'utf-8'
  );
  console.log('✅ System prompt carregado com sucesso.');
} catch (err) {
  console.warn('⚠️ System prompt não encontrado. Usando prompt padrão.');
  BASE_SYSTEM_PROMPT = `Você é a IAra, assistente virtual de suporte Salesforce da Cooxupé.
Ajude os usuários com dúvidas sobre o processo de vendas no Salesforce.
Seja calorosa, objetiva e profissional.`;
}

// Adaptação do prompt para contexto de chat web
const CHAT_ADAPTATION = `

## INSTRUÇÕES ADICIONAIS (CHAT WEB)

Você está agora respondendo via **chat web** no CRC Comercial Insumos, e NÃO via WhatsApp.
Adapte seu comportamento conforme abaixo:

1. **Formatação**: Use Markdown para formatação de texto:
   - **negrito** para termos-chave
   - *itálico* para ênfase
   - Listas com - ou 1. 2. 3.
   - Blocos de código com \`código\` se necessário

2. **Escalação**: Quando normalmente direcionaria para o "grupo de WhatsApp Suporte Salesforce Cooxupé" ou para uma pessoa/equipe específica, diga algo como:
   "Esse caso precisa de um atendimento mais especializado. Posso te transferir para um analista disponível agora mesmo! É só confirmar."
   
3. **Mantenha** o mesmo tom caloroso, humano e acolhedor.

4. **Não mencione WhatsApp** em suas respostas. Quando o FAQ original citar WhatsApp, adapte para o contexto do chat.

5. **Detecção de Escalação**: Se a dúvida envolver:
   - Erro técnico real / pedido travado / falha de integração → sugira transferência
   - Dúvida de negócio específica → sugira transferência
   - Aumento de limite de agendamento → sugira transferência
   - Acesso a dados reais do sistema → sugira transferência
   Em todos esses casos, INCLUA a frase exata "[SUGERIR_TRANSFERENCIA]" no FINAL da sua resposta (após o texto visível ao usuário).
`;

const FULL_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + CHAT_ADAPTATION;

// ============================================
// ESCALATION DETECTION
// ============================================

const ESCALATION_MARKERS = [
  '[SUGERIR_TRANSFERENCIA]',
];

const ESCALATION_KEYWORDS = [
  'transferir para um analista',
  'atendimento mais especializado',
  'precisa de suporte técnico',
  'analista comercial',
  'time de cdi',
  'time de ti',
  'área de ti',
  'não possuo essa informação',
  'fora do meu escopo',
  'não tenho acesso a dados reais',
  'suporte técnico',
];

export function detectEscalation(text: string): boolean {
  const lower = text.toLowerCase();
  // Check explicit markers
  if (ESCALATION_MARKERS.some(m => text.includes(m))) return true;
  // Check keywords
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function cleanResponse(text: string): string {
  // Remove escalation markers from visible text
  return text.replace(/\[SUGERIR_TRANSFERENCIA\]/g, '').trim();
}

// ============================================
// GROQ API CALL
// ============================================

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  text: string;
  suggestsTransfer: boolean;
  error?: string;
}

export async function getAIResponse(
  conversationHistory: { sender_type: string; text: string }[]
): Promise<AIResponse> {
  if (!GROQ_API_KEY) {
    return {
      text: 'Desculpe, o serviço de IA está temporariamente indisponível. Posso te transferir para um analista?',
      suggestsTransfer: true,
      error: 'GROQ_API_KEY not configured',
    };
  }

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: FULL_SYSTEM_PROMPT },
  ];

  // Add conversation history (last 20 messages for context window management)
  const recent = conversationHistory.slice(-20);
  for (const msg of recent) {
    if (msg.sender_type === 'user') {
      messages.push({ role: 'user', content: msg.text });
    } else if (msg.sender_type === 'ai') {
      messages.push({ role: 'assistant', content: msg.text });
    }
    // Skip 'analyst' and 'system' messages
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Groq API error:', response.status, errorText);
      return {
        text: 'Desculpe, estou com uma dificuldade técnica no momento. Posso te transferir para um analista humano?',
        suggestsTransfer: true,
        error: `Groq API ${response.status}`,
      };
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    const suggestsTransfer = detectEscalation(rawText);
    const cleanText = cleanResponse(rawText);

    return {
      text: cleanText,
      suggestsTransfer,
    };
  } catch (err: any) {
    console.error('❌ Groq API fetch error:', err.message);
    return {
      text: 'Desculpe, não consegui processar sua mensagem. Posso te transferir para um analista?',
      suggestsTransfer: true,
      error: err.message,
    };
  }
}
